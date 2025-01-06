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
import { findShiftGaps, canFitInGap } from '../../utils/gaps.js'

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

// Check if two service execution times overlap (including their durations)
function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  // These are actual execution times, so current names are good
  const existingStartMs = existingStart.getTime()
  const existingEndMs = existingEnd.getTime()
  const newStartMs = newStart.getTime()
  const newEndMs = newEnd.getTime()

  // No overlap if one service ends exactly when the other starts
  if (newStartMs === existingEndMs || existingStartMs === newEndMs) {
    return false
  }

  // Check if either service starts during the other's time window
  return (
    (newStartMs < existingEndMs && newStartMs >= existingStartMs) ||
    (existingStartMs < newEndMs && existingStartMs >= newStartMs)
  )
}

function getTimeWindowOverlapScore(service, shiftServices) {
  const nextEarliestStart = new Date(service.time.range[0])
  const nextLatestStart = new Date(service.time.range[1])
  const nextDuration = service.time.duration * 60 * 1000

  let totalOverlap = 0
  for (const existing of shiftServices) {
    const existingEarliestStart = new Date(existing.time.range[0])
    const existingLatestStart = new Date(existing.time.range[1])
    const existingDuration = existing.time.duration * 60 * 1000

    // Check both directions:
    // 1. Can this service start before existing service ends?
    // 2. Can this service end before existing service starts?
    const overlapStart = Math.max(nextEarliestStart, existingEarliestStart)
    const overlapEnd = Math.min(
      new Date(nextLatestStart.getTime() + nextDuration),
      new Date(existingLatestStart.getTime() + existingDuration)
    )

    if (overlapEnd > overlapStart) {
      const overlap = (overlapEnd - overlapStart) / (60 * 1000) // Convert to minutes
      totalOverlap += overlap
    }
  }

  return totalOverlap / (SHIFT_DURATION / 2)
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
  distanceMatrix
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
    const nextDistance = getDistance(service, nextService, distanceMatrix)

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

function getDistance(service1, service2, distanceMatrix) {
  if (!service1?.location?.id || !service2?.location?.id) return null

  // Try distance matrix first
  const key = `${service1.location.id},${service2.location.id}`
  const matrixDistance = distanceMatrix[key]
  
  // Fall back to direct calculation if matrix lookup fails
  if (matrixDistance === undefined || matrixDistance === null) {
    return calculateDistance(service1, service2)
  }
  
  return matrixDistance
}

function createScheduledService(service, shift, matchInfo, distanceMatrix) {
  const lastService = shift.services[shift.services.length - 1]
  const distance = lastService ? getDistance(lastService, service, distanceMatrix) : 0
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
  const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION_MS)

  return {
    services: [], // Initialize with empty services array
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

function calculateDistance(service1, service2) {
  if (!service1?.location?.latitude || !service1?.location?.longitude || 
      !service2?.location?.latitude || !service2?.location?.longitude) {
    return null
  }

  const lat1 = service1.location.latitude
  const lon1 = service1.location.longitude
  const lat2 = service2.location.latitude
  const lon2 = service2.location.longitude

  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function processServices(services, distanceMatrix) {
  try {
    const startTime = performance.now()
    SCORE_CACHE.clear()

    // Create a Map to track services by ID for efficient lookup
    const serviceMap = new Map()
    const scheduledServiceIds = new Set()

    // Pre-filter and deduplicate services
    services.forEach(service => {
      if (
        service &&
        service.time &&
        service.time.range &&
        service.time.range[0] &&
        service.time.range[1] &&
        isValidTimeRange(new Date(service.time.range[0]), new Date(service.time.range[1])) &&
        service.location?.id && // Ensure service has a location ID
        !scheduledServiceIds.has(service.id) // Skip if already scheduled
      ) {
        // Only keep the first instance of each service ID
        if (!serviceMap.has(service.id)) {
          serviceMap.set(service.id, service)
        }
      }
    })

    // Convert to array and add metadata
    const sortedServices = Array.from(serviceMap.values())
      .map(service => ({
        ...service,
        borough: getBorough(service.location.latitude, service.location.longitude),
        startTimeWindow: new Date(service.time.range[1]).getTime() - new Date(service.time.range[0]).getTime(),
        earliestStart: new Date(service.time.range[0]),
        latestStart: new Date(service.time.range[1]),
      }))
      .sort((a, b) => {
        // Sort by earliest start time first
        const timeCompare = a.earliestStart.getTime() - b.earliestStart.getTime()
        if (timeCompare !== 0) return timeCompare
        // Then by time window size (smaller windows first)
        return a.startTimeWindow - b.startTimeWindow
      })

    const shifts = []

    // First pass: Try to schedule each service in existing shifts
    for (const service of sortedServices) {
      // Skip if already scheduled
      if (scheduledServiceIds.has(service.id)) continue

      let bestMatch = null
      let bestShift = null
      let bestScore = -Infinity

      // Try to fit in existing shifts first
      for (const shift of shifts) {
        // Skip if shift already has this service or any service with the same ID
        if (shift.services.some(s => s.id === service.id)) continue

        const gaps = findShiftGaps(shift)
        
        for (const gap of gaps) {
          // Skip if service can't fit in gap
          if (!canFitInGap(service, gap)) continue

          // Find previous and next services
          const prevService = shift.services
            .filter(s => new Date(s.end).getTime() <= gap.start.getTime())
            .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0]
            
          const nextService = shift.services
            .filter(s => new Date(s.start).getTime() >= gap.end.getTime())
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]

          // Calculate distances using location IDs with fallback
          const prevDistance = prevService 
            ? getDistance(prevService, service, distanceMatrix)
            : 0
          const nextDistance = nextService
            ? getDistance(service, nextService, distanceMatrix)
            : 0

          if (prevDistance > HARD_MAX_RADIUS_MILES || 
              nextDistance > HARD_MAX_RADIUS_MILES) continue

          const prevTravelTime = calculateTravelTime(prevDistance)
          const nextTravelTime = calculateTravelTime(nextDistance)

          // Calculate earliest possible start in gap
          const earliestPossibleStart = prevService
            ? new Date(new Date(prevService.end).getTime() + prevTravelTime * 60000)
            : gap.start

          // Calculate latest possible end in gap
          const latestPossibleEnd = nextService
            ? new Date(new Date(nextService.start).getTime() - nextTravelTime * 60000)
            : gap.end

          // Ensure we have enough time for the service and travel
          const serviceAndTravelDuration = service.time.duration + 
            (prevService ? prevTravelTime : 0) + 
            (nextService ? nextTravelTime : 0)

          const availableTime = (latestPossibleEnd.getTime() - earliestPossibleStart.getTime()) / (60 * 1000)
          
          if (availableTime < serviceAndTravelDuration) continue

          // Check if service's time window allows this placement
          const tryStart = new Date(Math.max(earliestPossibleStart.getTime(), service.earliestStart.getTime()))
          if (tryStart.getTime() > service.latestStart.getTime()) continue

          const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
          if (tryEnd.getTime() > latestPossibleEnd.getTime()) continue

          // Verify no overlap with existing services
          const hasOverlap = shift.services.some(s => 
            checkTimeOverlap(
              new Date(s.start),
              new Date(s.end),
              tryStart,
              tryEnd
            )
          )
          if (hasOverlap) continue

          // Score this gap placement
          const score = calculateServiceScore(
            service,
            prevService || { end: gap.start },
            prevDistance,
            prevTravelTime,
            shift.services,
            sortedServices.filter(s => !scheduledServiceIds.has(s.id)),
            distanceMatrix
          )

          if (score > bestScore) {
            bestScore = score
            bestMatch = {
              start: tryStart,
              end: tryEnd,
              prevService,
              nextService,
              distance: prevDistance,
              travelTime: prevTravelTime
            }
            bestShift = shift
          }
        }
      }

      // If no suitable gap found, create new shift
      if (!bestMatch) {
        const newShift = createNewShift(service, shifts.length)
        shifts.push(newShift)
        bestShift = newShift
        bestMatch = {
          start: newShift.startTime,
          end: new Date(newShift.startTime.getTime() + service.time.duration * 60000),
          prevService: null,
          nextService: null,
          distance: 0,
          travelTime: 0
        }
      }

      // Schedule the service
      const scheduledService = createScheduledService(service, bestShift, bestMatch, distanceMatrix)
      bestShift.services.push(scheduledService)
      scheduledServiceIds.add(service.id)
    }

    // Sort services within each shift by start time and update metadata
    for (const shift of shifts) {
      shift.services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      
      // Update sequence numbers and previous service info
      shift.services.forEach((service, index) => {
        service.sequenceNumber = index + 1
        if (index > 0) {
          const prevService = shift.services[index - 1]
          service.previousService = prevService.id
          service.previousCompany = prevService.company
          const distance = getDistance(prevService, service, distanceMatrix) || 0
          service.distanceFromPrevious = distance
          service.travelTimeFromPrevious = calculateTravelTime(distance)
        } else {
          service.previousService = null
          service.previousCompany = null
          service.distanceFromPrevious = 0
          service.travelTimeFromPrevious = 0
        }
      })
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

    return {
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(performance.now() - startTime),
        connectedPointsCount: processedServices.length,
        totalClusters: clusters.size,
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

    // Even in case of error, try to assign techs to services
    const processedServices = services.map((service, index, array) => {
      const techId = `Tech ${Math.floor(index / 14) + 1}` // Assign up to 14 services per tech
      const prevService = index > 0 ? array[index - 1] : null
      let distance = 0
      if (prevService && distanceMatrix && 
          typeof prevService.originalIndex !== 'undefined' && 
          typeof service.originalIndex !== 'undefined') {
        distance = distanceMatrix[prevService.originalIndex][service.originalIndex] || 0
      }
      const travelTime = distance ? calculateTravelTime(distance) : 0
      return {
        ...service,
        cluster: -1,
        techId,
        distanceFromPrevious: distance,
        travelTimeFromPrevious: travelTime,
        previousService: prevService?.id || null,
        previousCompany: prevService?.company || null,
      }
    })

    // Create tech assignments even for error case
    const techAssignments = {}
    for (const service of processedServices) {
      if (!techAssignments[service.techId]) {
        techAssignments[service.techId] = {
          services: 0,
          startTime: new Date(service.start).getTime() % (24 * 60 * 60 * 1000),
        }
      }
      techAssignments[service.techId].services++
    }

    return {
      error: error.message,
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: 0,
        connectedPointsCount: 0,
        totalClusters: 0,
        clusterDistribution: [],
        techAssignments,
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
