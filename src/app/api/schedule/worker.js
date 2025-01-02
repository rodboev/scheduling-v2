import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough } from '../../utils/boroughs.js'
import {
  MAX_RADIUS_MILES_ACROSS_BOROUGHS,
  HARD_MAX_RADIUS_MILES,
  SHIFT_DURATION,
  ENFORCE_BOROUGH_BOUNDARIES,
  TECH_SPEED_MPH,
} from '../../utils/constants.js'
import { getBorough } from '../../utils/boroughs.js'
import { calculateTravelTime } from '../../map/utils/travelTime.js'

const MAX_TIME_SEARCH = 2 * 60 // 2 hours in minutes
const MAX_TRAVEL_TIME = 15 // maximum travel time between services in minutes

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

function verifyShiftDistances(shift, service, distanceMatrix) {
  // First verify the new service against all existing services
  for (const existingService of shift.services) {
    const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
    if (!distance || distance > HARD_MAX_RADIUS_MILES) return false

    // Check borough boundaries for cross-borough services
    if (
      !areSameBorough(
        existingService.location.latitude,
        existingService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      ) &&
      distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS
    ) {
      return false
    }
  }

  // Calculate time window overlap
  const overlapScore = getTimeWindowOverlapScore(service, shift.services)

  // Be more lenient with distance checks if there's significant time window overlap
  const distanceThreshold =
    overlapScore > 60 ? HARD_MAX_RADIUS_MILES : MAX_RADIUS_MILES_ACROSS_BOROUGHS

  // Also verify all existing services against each other
  for (let i = 0; i < shift.services.length; i++) {
    for (let j = i + 1; j < shift.services.length; j++) {
      const distance =
        distanceMatrix[shift.services[i].originalIndex][shift.services[j].originalIndex]
      if (!distance || distance > distanceThreshold) return false

      if (
        !areSameBorough(
          shift.services[i].location.latitude,
          shift.services[i].location.longitude,
          shift.services[j].location.latitude,
          shift.services[j].location.longitude,
        ) &&
        distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS
      ) {
        return false
      }
    }
  }
  return true
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

  // Normalize overlap score
  return maxOverlap / (SHIFT_DURATION / 2) // Normalize to max half-shift overlap
}

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

function findBestNextService(
  currentService,
  remainingServices,
  distanceMatrix,
  shiftEnd,
  scheduledServices,
) {
  let bestService = null
  let bestScore = -Infinity
  let bestStart = null

  const currentIndex = currentService.originalIndex
  const currentEnd = new Date(currentService.end)

  // Calculate current shift duration
  const shiftStart = Math.min(...scheduledServices.map(s => new Date(s.start).getTime()))
  const shiftDuration = (currentEnd.getTime() - shiftStart) / (60 * 1000)

  // Sort remaining services by time flexibility and start time
  const sortedServices = [...remainingServices].sort((a, b) => {
    const aStart = new Date(a.time.range[0])
    const bStart = new Date(b.time.range[0])
    const timeCompare = aStart - bStart
    if (timeCompare !== 0) return timeCompare

    const aFlex = new Date(a.time.range[1]) - aStart
    const bFlex = new Date(b.time.range[1]) - bStart
    return aFlex - bFlex
  })

  for (const service of sortedServices) {
    const distance = distanceMatrix[currentIndex][service.originalIndex]
    if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

    // Check distances between this service and ALL scheduled services
    let hasDistanceViolation = false
    for (const scheduled of scheduledServices) {
      const scheduledDistance = distanceMatrix[scheduled.originalIndex][service.originalIndex]
      if (!scheduledDistance || scheduledDistance > HARD_MAX_RADIUS_MILES) {
        hasDistanceViolation = true
        break
      }
    }
    if (hasDistanceViolation) continue

    const travelTime = calculateTravelTime(distance)
    const rangeStart = new Date(service.time.range[0])
    const rangeEnd = new Date(service.time.range[1])

    // Start time must be exactly travel time after current service end
    let tryStart = new Date(currentEnd.getTime() + travelTime * 60000)

    // If tryStart is before the service's allowed range, use rangeStart
    if (tryStart < rangeStart) {
      tryStart = new Date(rangeStart)
    }

    const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

    // Check if adding this service would exceed 8 hours
    const newShiftDuration =
      (Math.max(serviceEnd.getTime(), currentEnd.getTime()) - shiftStart) / (60 * 1000)
    if (newShiftDuration > SHIFT_DURATION) continue

    let hasConflict = false
    for (const scheduled of scheduledServices) {
      if (
        checkTimeOverlap(new Date(scheduled.start), new Date(scheduled.end), tryStart, serviceEnd)
      ) {
        hasConflict = true
        break
      }
    }

    if (!hasConflict) {
      // Enhanced scoring system
      const distanceScore = -Math.pow(distance / HARD_MAX_RADIUS_MILES, 2) * 50
      const durationBonus = Math.min(newShiftDuration, SHIFT_DURATION) / 60 // Bonus for longer shifts
      const flexibilityPenalty = -Math.log((rangeEnd - rangeStart) / (60 * 60 * 1000))

      // Calculate time window overlap score
      const timeWindowOverlap = getTimeWindowOverlapScore(service, scheduledServices)
      const preferredTime = new Date(service.time.preferred)
      const preferredDiff = Math.abs(tryStart - preferredTime) / 60000
      const preferredScore = -Math.log(preferredDiff + 1)

      // Calculate future compatibility score
      const futureScore = calculateFutureCompatibilityScore(
        service,
        tryStart,
        serviceEnd,
        remainingServices,
        distanceMatrix,
        3, // Lookahead depth
      )

      const score =
        distanceScore * 0.3 +
        durationBonus * 0.2 +
        flexibilityPenalty * 0.1 +
        timeWindowOverlap * 0.2 +
        preferredScore * 0.1 +
        futureScore * 0.1

      if (score > bestScore) {
        bestScore = score
        bestService = service
        bestStart = tryStart
      }
    }
  }

  return bestService ? { service: bestService, start: bestStart } : null
}

function calculateFutureCompatibilityScore(
  service,
  startTime,
  endTime,
  remainingServices,
  distanceMatrix,
  depth,
) {
  if (depth === 0 || remainingServices.length === 0) return 0

  let maxCompatibilityScore = 0
  const serviceIndex = service.originalIndex

  for (const nextService of remainingServices) {
    if (nextService.originalIndex === serviceIndex) continue

    const distance = distanceMatrix[serviceIndex][nextService.originalIndex]
    if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

    const travelTime = calculateTravelTime(distance)
    const nextStart = new Date(nextService.time.range[0])
    const nextEnd = new Date(nextService.time.range[1])

    // Check if service can be scheduled after current service plus travel time
    const earliestStart = new Date(endTime.getTime() + travelTime * 60000)
    if (nextEnd <= earliestStart) continue

    // Score based on distance and how well the service fits after travel time
    const fitScore = nextStart >= earliestStart ? 1 : 0.5
    const compatibilityScore = (1 - distance / HARD_MAX_RADIUS_MILES) * fitScore

    // Recursively calculate compatibility with remaining services
    const futureScore = calculateFutureCompatibilityScore(
      nextService,
      nextStart,
      new Date(nextStart.getTime() + nextService.time.duration * 60 * 1000),
      remainingServices.filter(s => s.originalIndex !== nextService.originalIndex),
      distanceMatrix,
      depth - 1,
    )

    const totalScore = compatibilityScore * 0.7 + futureScore * 0.3
    maxCompatibilityScore = Math.max(maxCompatibilityScore, totalScore)
  }

  return maxCompatibilityScore
}

function processServices(services, distanceMatrix) {
  try {
    const startTime = performance.now()

    // Sort services by time window and start time
    const sortedServices = services
      .map((service, index) => ({
        ...service,
        originalIndex: index,
        borough: getBorough(service.location.latitude, service.location.longitude),
        timeWindow: new Date(service.time.range[1]) - new Date(service.time.range[0]),
        startTime: new Date(service.time.range[0]),
        endTime: new Date(service.time.range[1]),
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
      // Find best anchor service (one with earliest start time and least flexibility)
      const anchor = remainingServices[0]
      remainingServices = remainingServices.slice(1)

      // Create new shift with anchor service
      const shift = {
        services: [
          {
            ...anchor,
            cluster: clusterIndex,
            sequenceNumber: 1,
            start: formatDate(anchor.startTime),
            end: formatDate(new Date(anchor.startTime.getTime() + anchor.time.duration * 60000)),
            distanceFromPrevious: 0,
            travelTimeFromPrevious: 0,
            previousService: null,
            previousCompany: null,
          },
        ],
        cluster: clusterIndex,
      }
      shifts.push(shift)

      // Try to extend shift with compatible services
      let extended
      do {
        extended = false
        const lastService = shift.services[shift.services.length - 1]
        const lastEnd = new Date(lastService.end)
        const shiftStart = new Date(shift.services[0].start)

        // Find best next service
        let bestService = null
        let bestScore = -Infinity
        let bestIndex = -1
        let bestStart = null

        // Only consider services that could potentially fit
        const potentialServices = remainingServices.filter(service => {
          const rangeEnd = new Date(service.time.range[1])
          return (
            rangeEnd > lastEnd &&
            new Date(service.time.range[0]) < new Date(lastEnd.getTime() + MAX_TIME_SEARCH * 60000)
          )
        })

        for (let i = 0; i < potentialServices.length; i++) {
          const service = potentialServices[i]
          const distance = distanceMatrix[lastService.originalIndex][service.originalIndex]

          // Quick distance check
          if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

          // Calculate travel time and earliest possible start
          const travelTime = calculateTravelTime(distance)
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)
          const rangeStart = new Date(service.time.range[0])
          const rangeEnd = new Date(service.time.range[1])

          // If service can't start after travel time and before its end time, skip
          if (earliestStart > rangeEnd) continue

          // Use the later of earliest possible start or service's range start
          const tryStart = earliestStart < rangeStart ? rangeStart : earliestStart
          const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

          // Check shift duration
          const newDuration =
            (Math.max(tryEnd.getTime(), lastEnd.getTime()) - shiftStart.getTime()) / (60 * 1000)
          if (newDuration > SHIFT_DURATION) continue

          // Check for time conflicts
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

          // Calculate score
          const score = calculateServiceScore(
            service,
            lastService,
            distance,
            travelTime,
            shift.services,
            remainingServices,
            distanceMatrix,
          )

          if (score > bestScore) {
            bestScore = score
            bestService = service
            bestIndex = remainingServices.indexOf(service)
            bestStart = tryStart
          }
        }

        // Add best service if found and shift not full
        if (bestService && shift.services.length < 14) {
          const distance = distanceMatrix[lastService.originalIndex][bestService.originalIndex]
          const travelTime = calculateTravelTime(distance)

          shift.services.push({
            ...bestService,
            cluster: clusterIndex,
            sequenceNumber: shift.services.length + 1,
            start: formatDate(bestStart),
            end: formatDate(new Date(bestStart.getTime() + bestService.time.duration * 60000)),
            distanceFromPrevious: distance,
            travelTimeFromPrevious: travelTime,
            previousService: lastService.id,
            previousCompany: lastService.company,
          })

          remainingServices.splice(bestIndex, 1)
          extended = true
        }
      } while (extended && shift.services.length < 14)

      clusterIndex++
    }

    // Try to merge compatible shifts
    let merged
    do {
      merged = false
      for (let i = 0; i < shifts.length - 1; i++) {
        const shift1 = shifts[i]
        const lastService = shift1.services[shift1.services.length - 1]
        const lastEnd = new Date(lastService.end)

        // Only consider shifts that could potentially merge
        const mergeCandidates = shifts.slice(i + 1).filter(s => {
          const firstStart = new Date(s.services[0].start)
          return (
            firstStart > lastEnd &&
            firstStart < new Date(lastEnd.getTime() + MAX_TIME_SEARCH * 60000)
          )
        })

        for (const shift2 of mergeCandidates) {
          const firstService = shift2.services[0]
          const distance = distanceMatrix[lastService.originalIndex][firstService.originalIndex]

          if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

          const travelTime = calculateTravelTime(distance)
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

          // Quick validation of merge possibility
          if (earliestStart > new Date(firstService.time.range[1])) continue

          // Check if merged shift would be valid
          const totalServices = shift1.services.length + shift2.services.length
          if (totalServices > 14) continue

          const mergedStart = Math.min(
            new Date(shift1.services[0].start).getTime(),
            new Date(shift2.services[0].start).getTime(),
          )
          const mergedEnd = Math.max(
            new Date(shift1.services[shift1.services.length - 1].end).getTime(),
            new Date(shift2.services[shift2.services.length - 1].end).getTime(),
          )
          const mergedDuration = (mergedEnd - mergedStart) / (60 * 1000)
          if (mergedDuration > SHIFT_DURATION) continue

          // If we get here, merge is possible - adjust first service of shift2
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

          // Add remaining services from shift2 with updated cluster and sequence
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

          // Merge the shifts
          shift1.services = [...shift1.services, adjustedFirstService, ...remainingServices]
          shifts.splice(shifts.indexOf(shift2), 1)
          merged = true
          break
        }
        if (merged) break
      }
    } while (merged)

    const processedServices = shifts.flatMap(shift => shift.services)

    const endTime = performance.now()
    const duration = endTime - startTime

    // Calculate clustering info
    const clusters = new Set(processedServices.map(s => s.cluster).filter(c => c >= 0))
    const clusterSizes = Array.from(clusters).map(
      c => processedServices.filter(s => s.cluster === c).length,
    )

    return {
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(duration),
        connectedPointsCount: processedServices.length,
        totalClusters: clusters.size,
        clusterSizes,
        clusterDistribution: Array.from(clusters).map(c => ({
          [c]: processedServices.filter(s => s.cluster === c).length,
        })),
      },
    }
  } catch (error) {
    console.error('Error in worker:', error)
    throw error
  }
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
  // Distance score - penalize longer distances exponentially
  const distanceScore = -Math.pow(distance / HARD_MAX_RADIUS_MILES, 2) * 50

  // Time window overlap score
  const timeWindowOverlap = getTimeWindowOverlapScore(service, scheduledServices)

  // Preferred time score
  const tryStart = new Date(lastService.end)
  const preferredTime = new Date(service.time.preferred)
  const preferredDiff = Math.abs(tryStart - preferredTime) / 60000
  const preferredScore = -Math.log(preferredDiff + 1)

  // Simple future compatibility - just check the next service
  let futureScore = 0
  if (remainingServices.length > 0) {
    const nextServices = remainingServices.filter(s => s !== service).slice(0, 3) // Only look at next 3 services without recursion

    for (const nextService of nextServices) {
      const nextDistance = distanceMatrix[service.originalIndex][nextService.originalIndex]
      if (!nextDistance || nextDistance > HARD_MAX_RADIUS_MILES) continue

      const nextTravelTime = calculateTravelTime(nextDistance)
      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
      const earliestNextStart = new Date(serviceEnd.getTime() + nextTravelTime * 60000)
      const nextRangeStart = new Date(nextService.time.range[0])
      const nextRangeEnd = new Date(nextService.time.range[1])

      // Score based on if next service could fit after this one
      if (earliestNextStart <= nextRangeEnd) {
        const fitScore = nextRangeStart >= earliestNextStart ? 1 : 0.5
        const nextScore = (1 - nextDistance / HARD_MAX_RADIUS_MILES) * fitScore
        futureScore = Math.max(futureScore, nextScore)
      }
    }
  }

  return (
    distanceScore * 0.4 + // Prioritize distance more
    timeWindowOverlap * 0.3 + // Keep good overlap score weight
    preferredScore * 0.2 + // Slightly reduce preferred time importance
    futureScore * 0.1 // Reduce future compatibility weight
  )
}

function getShiftForTime(time) {
  const hour = new Date(time).getUTCHours()
  if (hour >= 8 && hour < 16) return 1
  if (hour >= 16) return 2
  return 3
}

function addServiceToShift(service, shift, distanceMatrix) {
  // If this is the first service in the shift
  if (shift.services.length === 0) {
    return {
      ...service,
      cluster: shift.cluster,
      start: shift.startTime.toISOString(),
      end: new Date(shift.startTime.getTime() + service.time.duration * 60000).toISOString(),
      previousService: null,
      previousCompany: null,
      distanceFromPrevious: null,
      travelTimeFromPrevious: null,
    }
  }

  // Get the previous service and calculate distance
  const previousService = shift.services[shift.services.length - 1]
  const distance = distanceMatrix[previousService.originalIndex][service.originalIndex]
  const travelTime = distance ? calculateTravelTime(distance) : 0

  // Calculate start time based on previous service end plus travel time
  const previousEnd = new Date(previousService.end)
  const serviceStart = new Date(previousEnd.getTime() + travelTime * 60000)

  return {
    ...service,
    cluster: shift.cluster,
    start: serviceStart.toISOString(),
    end: new Date(serviceStart.getTime() + service.time.duration * 60000).toISOString(),
    previousService: previousService.id,
    previousCompany: previousService.company,
    distanceFromPrevious: distance,
    travelTimeFromPrevious: travelTime,
  }
}

function mergeServices(services, distanceMatrix) {
  const mergedServices = []

  for (const service of services) {
    if (mergedServices.length === 0) {
      mergedServices.push({
        ...service,
        previousService: null,
        previousCompany: null,
        distanceFromPrevious: null,
        travelTimeFromPrevious: null,
      })
      continue
    }

    const previousService = mergedServices[mergedServices.length - 1]
    const distance = distanceMatrix[previousService.originalIndex][service.originalIndex]
    const travelTime = distance ? calculateTravelTime(distance) : 0
    const previousEnd = new Date(previousService.end)
    let serviceStart = new Date(service.start)

    // Ensure minimum gap equals travel time
    if (serviceStart - previousEnd < travelTime * 60000) {
      serviceStart.setTime(previousEnd.getTime() + travelTime * 60000)
    }

    mergedServices.push({
      ...service,
      start: formatDate(serviceStart),
      end: formatDate(new Date(serviceStart.getTime() + service.time.duration * 60000)),
      previousService: previousService.id,
      previousCompany: previousService.company,
      distanceFromPrevious: distance,
      travelTimeFromPrevious: travelTime,
    })
  }

  return mergedServices
}

// Handle messages from the main thread
parentPort.on('message', async ({ services, distanceMatrix }) => {
  try {
    const result = await processServices(services, distanceMatrix)
    parentPort.postMessage(result)
  } catch (error) {
    console.error('Worker error:', error)
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
