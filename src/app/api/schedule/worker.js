import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough } from '../../utils/boroughs.js'
import {
  MAX_RADIUS_MILES_ACROSS_BOROUGHS,
  HARD_MAX_RADIUS_MILES,
  SHIFT_DURATION,
  SHIFT_DURATION_MS,
  ENFORCE_BOROUGH_BOUNDARIES,
  TECH_SPEED_MPH,
  MAX_TIME_SEARCH,
  MAX_MERGE_ATTEMPTS,
  MERGE_CLOSEST_SHIFTS,
  TECH_START_TIME_VARIANCE,
} from '../../utils/constants.js'
import { getBorough } from '../../utils/boroughs.js'
import { calculateTravelTime } from '../../map/utils/travelTime.js'
import dayjs from 'dayjs'

const SCORE_CACHE = new Map() // Cache for service compatibility scores

// Track tech start times across days
const techStartTimes = new Map()

function parseDate(dateStr) {
  const date = new Date(dateStr)
  return isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  if (!date || isNaN(date.getTime())) return null
  return date.toISOString()
}

function isValidTimeRange(start, end) {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return false
  return start < end && end - start <= SHIFT_DURATION * 60 * 60 * 1000
}

function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  if (
    newStart.getTime() === existingEnd.getTime() ||
    existingStart.getTime() === newEnd.getTime()
  ) {
    return false
  }

  return (
    (newStart < existingEnd && newStart >= existingStart) ||
    (newEnd > existingStart && newEnd <= existingEnd) ||
    (newStart <= existingStart && newEnd >= existingEnd)
  )
}

function getTimeWindowOverlapScore(service, shiftServices) {
  let maxOverlap = 0
  const serviceStart = new Date(service.time.range[0])
  const serviceEnd = new Date(service.time.range[1])

  for (const existing of shiftServices) {
    const existingStart = new Date(existing.time.range[0])
    const existingEnd = new Date(existing.time.range[1])

    // Calculate overlap duration in minutes
    const overlapStart = Math.max(serviceStart, existingStart)
    const overlapEnd = Math.min(serviceEnd, existingEnd)

    if (overlapEnd > overlapStart) {
      const overlap = (overlapEnd - overlapStart) / (1000 * 60)
      maxOverlap = Math.max(maxOverlap, overlap)
    }
  }

  return maxOverlap / (SHIFT_DURATION / 2)
}

function getCacheKey(service1, service2) {
  return `${service1.originalIndex}-${service2.originalIndex}`
}

function calculateServiceScore(
  service,
  lastService,
  distance,
  travelTime,
  scheduledServices,
  remainingServices,
  distanceMatrix,
) {
  const cacheKey = getCacheKey(service, lastService)
  if (SCORE_CACHE.has(cacheKey)) {
    const cachedScore = SCORE_CACHE.get(cacheKey)
    return cachedScore
  }

  // Quick distance check
  if (!distance || distance > HARD_MAX_RADIUS_MILES) {
    return -Infinity
  }

  // Distance score - penalize longer distances exponentially
  const distanceScore = -Math.pow(distance / HARD_MAX_RADIUS_MILES, 2) * 50

  // Time window overlap score
  const timeWindowOverlap = getTimeWindowOverlapScore(service, scheduledServices)

  // Preferred time score
  const tryStart = new Date(lastService.end)
  const preferredTime = new Date(service.time.preferred)
  const preferredDiff = Math.abs(tryStart - preferredTime) / 60000
  const preferredScore = -Math.log(preferredDiff + 1)

  // Simplified future compatibility - only check immediate next service
  let futureScore = 0
  if (remainingServices.length > 0) {
    const nextService = remainingServices[0]
    const nextDistance = distanceMatrix[lastService.originalIndex][nextService.originalIndex]

    if (nextDistance && nextDistance <= HARD_MAX_RADIUS_MILES) {
      const nextTravelTime = calculateTravelTime(nextDistance)
      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
      const earliestNextStart = new Date(serviceEnd.getTime() + nextTravelTime * 60000)
      const nextRangeStart = new Date(nextService.time.range[0])
      const nextRangeEnd = new Date(nextService.time.range[1])

      if (earliestNextStart <= nextRangeEnd) {
        const fitScore = nextRangeStart >= earliestNextStart ? 1 : 0.5
        futureScore = (1 - nextDistance / HARD_MAX_RADIUS_MILES) * fitScore
      }
    }
  }

  const score =
    distanceScore * 0.4 + timeWindowOverlap * 0.3 + preferredScore * 0.2 + futureScore * 0.1

  SCORE_CACHE.set(cacheKey, score)
  return score
}

function createScheduledService(service, shift, matchInfo) {
  const lastService = shift.services[shift.services.length - 1]
  const distance = lastService
    ? distanceMatrix[service.originalIndex][lastService.originalIndex]
    : 0
  const travelTime = distance ? calculateTravelTime(distance) : 0

  return {
    ...service,
    cluster: shift.cluster,
    sequenceNumber: shift.services.length + 1,
    start: formatDate(matchInfo.start),
    end: formatDate(new Date(matchInfo.start.getTime() + service.time.duration * 60000)),
    distanceFromPrevious: distance || 0,
    travelTimeFromPrevious: travelTime,
    previousService: lastService ? lastService.id : null,
    previousCompany: lastService ? lastService.company : null,
  }
}

function createNewShift(service, clusterIndex) {
  // Use preferred time if available, otherwise use earliest possible time
  const shiftStart = service.time.preferred
    ? new Date(service.time.preferred)
    : new Date(service.time.range[0])
  const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION * 60000)

  const newService = {
    ...service,
    cluster: clusterIndex,
    techId: `Tech ${clusterIndex + 1}`,
    sequenceNumber: 1,
    start: formatDate(shiftStart),
    end: formatDate(new Date(shiftStart.getTime() + service.time.duration * 60000)),
    distanceFromPrevious: 0,
    travelTimeFromPrevious: 0,
    previousService: null,
    previousCompany: null,
  }

  return {
    services: [newService],
    startTime: shiftStart,
    endTime: shiftEnd,
    cluster: clusterIndex,
    techId: `Tech ${clusterIndex + 1}`,
    mergeAttempts: 0,
  }
}

function assignTechsToShifts(shifts, dateStr) {
  // Group shifts by date
  const shiftsByDate = new Map()
  const techAssignmentsByDate = new Map() // Track tech assignments per day
  const totalClusters = new Set(shifts.map(s => s.cluster)).size // Get total number of unique clusters

  // Reset tech start times for new assignment
  techStartTimes.clear()

  for (const shift of shifts) {
    const shiftDate = dayjs(shift.services[0].start).format('YYYY-MM-DD')
    if (!shiftsByDate.has(shiftDate)) {
      shiftsByDate.set(shiftDate, [])
      techAssignmentsByDate.set(shiftDate, new Set())
    }
    shiftsByDate.get(shiftDate).push(shift)
  }

  // For each date, assign techs to shifts
  for (const [date, dateShifts] of shiftsByDate) {
    // Sort shifts by start time and size (prioritize larger clusters)
    dateShifts.sort((a, b) => {
      const timeCompare = new Date(a.services[0].start) - new Date(b.services[0].start)
      if (timeCompare !== 0) return timeCompare
      return b.services.length - a.services.length
    })

    // Assign techs to shifts
    for (let i = 0; i < dateShifts.length; i++) {
      const shift = dateShifts[i]
      const shiftStartTime = new Date(shift.services[0].start).getTime()
      const assignedTechs = techAssignmentsByDate.get(date)

      // Find the best tech for this shift
      let bestTech = null
      let bestVariance = Infinity

      // First, try to find an existing tech that matches the start time and isn't assigned today
      for (const [techId, prefStartTime] of techStartTimes) {
        if (assignedTechs.has(techId)) continue

        const variance = Math.abs((shiftStartTime % (24 * 60 * 60 * 1000)) - prefStartTime)
        if (variance <= TECH_START_TIME_VARIANCE && variance < bestVariance) {
          bestTech = techId
          bestVariance = variance
        }
      }

      // If no existing tech fits, create a new one (but only if we haven't exceeded total clusters)
      if (!bestTech && techStartTimes.size < totalClusters) {
        bestTech = `Tech ${techStartTimes.size + 1}`
      }

      // If still no tech, find the tech with the least work who isn't assigned today
      if (!bestTech) {
        const techWorkload = new Map()
        for (const [d, shifts] of shiftsByDate) {
          for (const s of shifts) {
            if (s.techId) {
              techWorkload.set(s.techId, (techWorkload.get(s.techId) || 0) + 1)
            }
          }
        }

        const availableTechs = Array.from(techWorkload.entries())
          .filter(([techId]) => !assignedTechs.has(techId))
          .sort((a, b) => a[1] - b[1])

        bestTech = availableTechs[0]?.[0]
      }

      // If we still don't have a tech, use the first available tech number
      if (!bestTech) {
        for (let techNum = 1; techNum <= totalClusters; techNum++) {
          const techId = `Tech ${techNum}`
          if (!assignedTechs.has(techId)) {
            bestTech = techId
            break
          }
        }
      }

      // Assign the tech to the shift
      shift.techId = bestTech
      assignedTechs.add(bestTech)

      // Update the tech's preferred start time if not set
      if (!techStartTimes.has(bestTech)) {
        techStartTimes.set(bestTech, shiftStartTime % (24 * 60 * 60 * 1000))
      }

      // Update all services in the shift with the tech ID
      for (const service of shift.services) {
        service.techId = bestTech
      }
    }
  }

  return shifts
}

function processServices(services, distanceMatrix) {
  try {
    const startTime = performance.now()
    SCORE_CACHE.clear()

    // Pre-filter invalid services
    const validServices = services.filter(
      service =>
        service &&
        service.time &&
        service.time.range &&
        service.time.range[0] &&
        service.time.range[1],
    )

    // Calculate latest possible start time for each service
    const latestStart = service =>
      new Date(service.time.range[1]).getTime() - service.time.duration * 60000

    // Sort services by time window and start time
    const sortedServices = validServices
      .map((service, index) => ({
        ...service,
        originalIndex: index,
        borough: getBorough(service.location.latitude, service.location.longitude),
        timeWindow: latestStart(service) - new Date(service.time.range[0]).getTime(),
        startTime: new Date(service.time.range[0]),
        endTime: new Date(latestStart(service)),
      }))
      .filter(service => service && isValidTimeRange(service.startTime, service.endTime))
      .sort((a, b) => {
        // Sort by start time first
        const timeCompare = a.startTime - b.startTime
        if (timeCompare !== 0) return timeCompare
        // Then by time window flexibility
        return a.timeWindow - b.timeWindow
      })

    const shifts = []
    let clusterIndex = 0
    let remainingServices = [...sortedServices]

    // Process services until none remain
    while (remainingServices.length > 0) {
      const anchor = remainingServices[0]
      remainingServices = remainingServices.slice(1)

      const shift = createNewShift(anchor, clusterIndex)
      shifts.push(shift)

      // Try to extend shift with compatible services
      let extended
      do {
        extended = false
        const lastService = shift.services[shift.services.length - 1]
        const lastEnd = new Date(lastService.end)
        const shiftStart = new Date(shift.services[0].start)

        // Find best next service
        let bestMatch = null

        // Only consider services that could potentially fit
        const potentialServices = remainingServices.filter(service => {
          const rangeEnd = new Date(service.time.range[1])
          return (
            rangeEnd > lastEnd &&
            new Date(service.time.range[0]) < new Date(lastEnd.getTime() + MAX_TIME_SEARCH * 60000)
          )
        })

        for (const service of potentialServices) {
          const distance = distanceMatrix[lastService.originalIndex][service.originalIndex]
          if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

          const travelTime = calculateTravelTime(distance)
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)
          const rangeStart = new Date(service.time.range[0])
          const rangeEnd = new Date(service.time.range[1])

          if (earliestStart > rangeEnd) continue

          const tryStart = earliestStart < rangeStart ? rangeStart : earliestStart
          const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

          const newDuration = (tryEnd.getTime() - shiftStart.getTime()) / (60 * 1000)
          if (newDuration > SHIFT_DURATION) continue

          let hasConflict = false
          for (const scheduled of shift.services) {
            if (
              checkTimeOverlap(new Date(scheduled.start), new Date(scheduled.end), tryStart, tryEnd)
            ) {
              hasConflict = true
              break
            }
          }
          if (hasConflict) continue

          const score = calculateServiceScore(
            service,
            lastService,
            distance,
            travelTime,
            shift.services,
            remainingServices,
            distanceMatrix,
          )

          if (!bestMatch || score > bestMatch.score) {
            bestMatch = {
              service,
              start: tryStart,
              score,
              index: remainingServices.indexOf(service),
            }
          }
        }

        if (bestMatch && shift.services.length < 14) {
          const distance =
            distanceMatrix[lastService.originalIndex][bestMatch.service.originalIndex]
          const travelTime = calculateTravelTime(distance)

          shift.services.push({
            ...bestMatch.service,
            cluster: clusterIndex,
            sequenceNumber: shift.services.length + 1,
            start: formatDate(bestMatch.start),
            end: formatDate(
              new Date(bestMatch.start.getTime() + bestMatch.service.time.duration * 60000),
            ),
            distanceFromPrevious: distance,
            travelTimeFromPrevious: travelTime,
            previousService: lastService.id,
            previousCompany: lastService.company,
          })

          remainingServices.splice(bestMatch.index, 1)
          extended = true
        }
      } while (extended && shift.services.length < 14)

      clusterIndex++
    }

    // Optimized shift merging
    let merged
    do {
      merged = false
      const shiftsByTime = [...shifts].sort((a, b) => {
        const aStart = new Date(a.services[0].start).getTime()
        const bStart = new Date(b.services[0].start).getTime()
        return aStart - bStart
      })

      for (let i = 0; i < shiftsByTime.length - 1; i++) {
        const shift1 = shiftsByTime[i]
        if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

        const lastService = shift1.services[shift1.services.length - 1]
        const lastEnd = new Date(lastService.end)

        // Only consider nearby shifts in time
        const mergeCandidates = shiftsByTime
          .slice(i + 1)
          .filter(s => {
            if (s.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
            const firstStart = new Date(s.services[0].start)
            return (
              firstStart > lastEnd &&
              firstStart < new Date(lastEnd.getTime() + MAX_TIME_SEARCH * 60000)
            )
          })
          .slice(0, MERGE_CLOSEST_SHIFTS)

        for (const shift2 of mergeCandidates) {
          const firstService = shift2.services[0]
          const distance = distanceMatrix[lastService.originalIndex][firstService.originalIndex]

          if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

          const travelTime = calculateTravelTime(distance)
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

          if (earliestStart > new Date(firstService.time.range[1])) continue

          const totalServices = shift1.services.length + shift2.services.length
          if (totalServices > 14) continue

          const mergedDuration =
            (Math.max(
              new Date(shift1.services[shift1.services.length - 1].end).getTime(),
              new Date(shift2.services[shift2.services.length - 1].end).getTime(),
            ) -
              Math.min(
                new Date(shift1.services[0].start).getTime(),
                new Date(shift2.services[0].start).getTime(),
              )) /
            (60 * 1000)

          if (mergedDuration > SHIFT_DURATION) continue

          // If we get here, merge is possible
          const adjustedFirstService = {
            ...firstService,
            cluster: shift1.cluster,
            sequenceNumber: shift1.services.length + 1,
            start: formatDate(earliestStart),
            end: formatDate(new Date(earliestStart.getTime() + firstService.time.duration * 60000)),
            distanceFromPrevious: distance,
            travelTimeFromPrevious: travelTime,
            previousService: lastService.id,
            previousCompany: lastService.company,
          }

          const remainingServices = shift2.services.slice(1).map((service, index) => {
            const prev = index === 0 ? adjustedFirstService : shift2.services[index]
            const dist = distanceMatrix[prev.originalIndex][service.originalIndex]
            const travel = calculateTravelTime(dist)
            return {
              ...service,
              cluster: shift1.cluster,
              sequenceNumber: shift1.services.length + 2 + index,
              distanceFromPrevious: dist,
              travelTimeFromPrevious: travel,
              previousService: prev.id,
              previousCompany: prev.company,
            }
          })

          shift1.services = [...shift1.services, adjustedFirstService, ...remainingServices]
          shift1.mergeAttempts++
          shift2.mergeAttempts++
          shifts.splice(shifts.indexOf(shift2), 1)
          merged = true
          break
        }
        if (merged) break
      }
    } while (merged)

    // Assign techs to shifts
    const shiftsWithTechs = assignTechsToShifts(shifts)
    console.log('Shifts after tech assignment:', shiftsWithTechs.length)

    const processedServices = shiftsWithTechs.flatMap(shift => {
      return shift.services.map(service => {
        const processedService = {
          ...service,
          techId: shift.techId || `Tech ${service.cluster + 1}`,
          cluster: shift.cluster, // Ensure cluster is set from shift
        }
        return processedService
      })
    })

    // Calculate clustering info
    const clusters = new Set(processedServices.map(s => s.cluster).filter(c => c >= 0))
    console.log('Found clusters:', Array.from(clusters))

    const clusterSizes = Array.from(clusters).map(
      c => processedServices.filter(s => s.cluster === c).length,
    )

    return {
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(performance.now() - startTime),
        connectedPointsCount: processedServices.length,
        totalClusters: clusters.size,
        clusterSizes,
        clusterDistribution: Array.from(clusters).map(c => ({
          [c]: processedServices.filter(s => s.cluster === c).length,
        })),
        techAssignments: Object.fromEntries(
          Array.from(new Set(processedServices.map(s => s.techId))).map(techId => [
            techId,
            {
              services: processedServices.filter(s => s.techId === techId).length,
              startTime: techStartTimes.get(techId),
            },
          ]),
        ),
      },
    }
  } catch (error) {
    console.error('Error in worker:', error)
    return {
      error: error.message,
      scheduledServices: services.map((service, index) => ({
        ...service,
        cluster: -1,
        techId: 'Unassigned',
      })),
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: 0,
        connectedPointsCount: 0,
        totalClusters: 0,
        clusterSizes: [],
        clusterDistribution: [],
        techAssignments: {},
      },
    }
  }
}

// Handle messages from the main thread
parentPort.on('message', async ({ services, distanceMatrix }) => {
  try {
    console.log('Worker received services:', services.length)
    console.log(
      'Distance matrix dimensions:',
      distanceMatrix.length,
      'x',
      distanceMatrix[0]?.length,
    )

    const result = await processServices(services, distanceMatrix)
    console.log('Worker processed services:', result.scheduledServices.length)
    console.log(
      'Services with clusters:',
      result.scheduledServices.filter(s => s.cluster >= 0).length,
    )

    parentPort.postMessage(result)
  } catch (error) {
    console.error('Error in clustering worker:', error)
    parentPort.postMessage({
      error: error.message,
      scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: 0,
        connectedPointsCount: 0,
        totalClusters: 0,
        clusterSizes: [],
        clusterDistribution: [],
      },
    })
  }
})

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
