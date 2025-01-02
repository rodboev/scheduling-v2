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

const TIME_INCREMENT = 15 // 15 minute increments
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

function calculateTravelTime(distanceMatrix, fromIndex, toIndex) {
  const distance = distanceMatrix[fromIndex][toIndex]
  if (!distance) return 30 // Default to 30 minutes if no distance available

  // Calculate travel time in minutes based on distance and speed
  return Math.ceil((distance / TECH_SPEED_MPH) * 60)
}

function roundToNearestInterval(date) {
  const minutes = date.getMinutes()
  const roundedMinutes = Math.ceil(minutes / TIME_INCREMENT) * TIME_INCREMENT
  const newDate = new Date(date)
  newDate.setMinutes(roundedMinutes)
  return newDate
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

  // Calculate current shift duration and utilization
  const shiftStart = Math.min(...scheduledServices.map(s => new Date(s.start).getTime()))
  const shiftDuration = (currentEnd.getTime() - shiftStart) / (60 * 1000)
  const shiftUtilization = shiftDuration / SHIFT_DURATION

  // Look ahead depth for future service compatibility
  const LOOKAHEAD_DEPTH = 3

  // Sort remaining services by potential score including lookahead
  const sortedServices = [...remainingServices].sort((a, b) => {
    const aScore = calculatePotentialScore(
      a,
      currentService,
      scheduledServices,
      remainingServices,
      distanceMatrix,
      LOOKAHEAD_DEPTH,
    )
    const bScore = calculatePotentialScore(
      b,
      currentService,
      scheduledServices,
      remainingServices,
      distanceMatrix,
      LOOKAHEAD_DEPTH,
    )
    return bScore - aScore
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

    // Calculate time window flexibility
    const serviceStart = new Date(service.time.range[0])
    const serviceEnd = new Date(service.time.range[1])
    const timeFlexibility = (serviceEnd - serviceStart) / (60 * 1000)

    // Try different start times within the service's time window
    const timeStep = 15 // minutes
    const maxStartTime = new Date(Math.min(serviceEnd.getTime(), shiftEnd.getTime()))

    for (
      let startTime = new Date(Math.max(currentEnd.getTime(), serviceStart.getTime()));
      startTime <= maxStartTime;
      startTime = new Date(startTime.getTime() + timeStep * 60 * 1000)
    ) {
      const endTime = new Date(startTime.getTime() + service.time.duration * 60 * 1000)
      if (endTime > shiftEnd) continue

      // Calculate base score components
      const timeScore = calculateTimeScore(startTime, currentEnd, timeFlexibility)
      const distanceScore = calculateDistanceScore(distance)
      const utilizationScore = calculateUtilizationScore(shiftUtilization, service.time.duration)

      // Calculate future compatibility score
      const futureScore = calculateFutureCompatibilityScore(
        service,
        startTime,
        endTime,
        remainingServices,
        distanceMatrix,
        LOOKAHEAD_DEPTH,
      )

      // Combine scores with weights
      const totalScore =
        timeScore * 0.3 + distanceScore * 0.25 + utilizationScore * 0.25 + futureScore * 0.2

      if (totalScore > bestScore) {
        bestScore = totalScore
        bestService = service
        bestStart = startTime
      }
    }
  }

  return bestService ? { service: bestService, start: bestStart } : null
}

function calculateTimeScore(startTime, currentEnd, timeFlexibility) {
  const gap = (startTime - currentEnd) / (60 * 1000) // gap in minutes
  const idealGap = 30 // ideal gap between services
  const gapPenalty = Math.abs(gap - idealGap) / 60 // Normalize to hours
  return Math.max(0, 1 - gapPenalty * 0.1) * (1 + Math.min(timeFlexibility / 480, 1) * 0.5)
}

function calculateDistanceScore(distance) {
  return Math.max(0, 1 - distance / HARD_MAX_RADIUS_MILES)
}

function calculateUtilizationScore(currentUtilization, serviceDuration) {
  const targetUtilization = 0.85 // Target 85% shift utilization
  const projectedUtilization = currentUtilization + serviceDuration / SHIFT_DURATION
  return Math.max(0, 1 - Math.abs(projectedUtilization - targetUtilization))
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

    const nextStart = new Date(nextService.time.range[0])
    const nextEnd = new Date(nextService.time.range[1])

    // Check if service can be scheduled after current service
    if (nextStart <= endTime || nextEnd <= endTime) continue

    const timeGap = (nextStart - endTime) / (60 * 1000)
    if (timeGap > 120) continue // Skip if gap is too large

    const compatibilityScore =
      (1 - distance / HARD_MAX_RADIUS_MILES) * 0.6 + (1 - timeGap / 120) * 0.4

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

function calculatePotentialScore(
  service,
  currentService,
  scheduledServices,
  remainingServices,
  distanceMatrix,
  depth,
) {
  const currentIndex = currentService.originalIndex
  const serviceIndex = service.originalIndex
  const distance = distanceMatrix[currentIndex][serviceIndex]

  if (!distance || distance > HARD_MAX_RADIUS_MILES) return -Infinity

  // Calculate base compatibility
  const baseScore = calculateDistanceScore(distance)

  // Calculate time window overlap
  const currentEnd = new Date(currentService.end)
  const serviceStart = new Date(service.time.range[0])
  const serviceEnd = new Date(service.time.range[1])
  const timeFlexibility = (serviceEnd - serviceStart) / (60 * 1000)
  const timeScore = calculateTimeScore(serviceStart, currentEnd, timeFlexibility)

  // Look ahead for future compatibility
  const futureScore = calculateFutureCompatibilityScore(
    service,
    serviceStart,
    new Date(serviceStart.getTime() + service.time.duration * 60 * 1000),
    remainingServices.filter(s => s.originalIndex !== serviceIndex),
    distanceMatrix,
    depth,
  )

  return baseScore * 0.3 + timeScore * 0.4 + futureScore * 0.3
}

function canAddServiceToShift(service, shift, distanceMatrix) {
  // First verify that the service can be added without violating distance constraints
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

  // Calculate time window overlap with existing services
  const overlapScore = getTimeWindowOverlapScore(service, shift.services)

  // If there's significant overlap, be more lenient with time gaps
  const timeGapThreshold = overlapScore > 60 ? 180 : 120 // minutes

  // Then check if it can be scheduled after any existing service
  for (const existingService of shift.services) {
    const travelTime = calculateTravelTime(
      distanceMatrix,
      existingService.originalIndex,
      service.originalIndex,
    )
    const timeGap = (new Date(service.time.range[0]) - new Date(existingService.end)) / (60 * 1000)

    if (timeGap <= timeGapThreshold) {
      const next = findBestNextService(
        existingService,
        [service],
        distanceMatrix,
        shift.endTime,
        shift.services,
      )
      if (next) return { next, existingService }
    }
  }
  return false
}

function createScheduledService(service, shift, matchInfo) {
  return {
    ...service,
    cluster: shift.cluster,
    start: matchInfo.start.toISOString(),
    end: new Date(matchInfo.start.getTime() + service.time.duration * 60000).toISOString(),
  }
}

function createNewShift(service, clusterIndex) {
  const shiftStart = new Date(service.time.range[0])
  const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION * 60000)

  return {
    services: [
      {
        ...service,
        cluster: clusterIndex,
        start: shiftStart.toISOString(),
        end: new Date(shiftStart.getTime() + service.time.duration * 60000).toISOString(),
      },
    ],
    startTime: shiftStart,
    endTime: shiftEnd,
    cluster: clusterIndex,
  }
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

  // Increase the weight of overlap score to encourage combining shifts
  return maxOverlap / 5 // Doubled the weight from previous value
}

function findCompatibleServices(
  service,
  remainingServices,
  distanceMatrix,
  currentShiftServices = [],
) {
  const compatibleServices = []
  const serviceStart = new Date(service.time.range[0])
  const serviceEnd = new Date(service.time.range[1])

  for (const candidate of remainingServices) {
    if (candidate.originalIndex === service.originalIndex) continue

    // Check distance constraints
    let isCompatible = true
    for (const existing of [service, ...currentShiftServices]) {
      const distance = distanceMatrix[existing.originalIndex][candidate.originalIndex]
      if (!distance || distance > HARD_MAX_RADIUS_MILES) {
        isCompatible = false
        break
      }

      // Check borough boundaries
      if (
        !areSameBorough(
          existing.location.latitude,
          existing.location.longitude,
          candidate.location.latitude,
          candidate.location.longitude,
        ) &&
        distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS
      ) {
        isCompatible = false
        break
      }
    }

    if (!isCompatible) continue

    // Check time window overlap
    const candidateStart = new Date(candidate.time.range[0])
    const candidateEnd = new Date(candidate.time.range[1])

    // Calculate overlap score
    const overlapStart = Math.max(serviceStart, candidateStart)
    const overlapEnd = Math.min(serviceEnd, candidateEnd)
    const overlapDuration = Math.max(0, (overlapEnd - overlapStart) / (60 * 1000))

    // Add to compatible services with overlap score
    if (overlapDuration > 0) {
      compatibleServices.push({
        service: candidate,
        overlapScore: overlapDuration,
      })
    }
  }

  // Sort by overlap score descending
  return compatibleServices.sort((a, b) => b.overlapScore - a.overlapScore)
}

function tryExtendShift(currentService, remainingServices, currentShift, distanceMatrix, shiftEnd) {
  // Initialize shift if empty
  const shift = [...currentShift]
  if (shift.length === 0) {
    const serviceStart = new Date(currentService.time.range[0])
    shift.push({
      ...currentService,
      start: serviceStart.toISOString(),
      end: new Date(serviceStart.getTime() + currentService.time.duration * 60000).toISOString(),
    })
    return { success: true, shift, score: 1 }
  }

  // Find best next service
  const result = findBestNextService(
    currentService,
    remainingServices,
    distanceMatrix,
    shiftEnd,
    shift,
  )

  if (!result) return { success: false, shift: currentShift, score: 0 }

  const { service: nextService, start: nextStart } = result

  // Verify shift constraints
  const newShift = [...shift]
  const serviceToAdd = {
    ...nextService,
    cluster: bestShift.cluster,
    sequenceNumber: bestShift.services.length + 1,
    start: formatDate(bestStart),
    end: formatDate(new Date(bestStart.getTime() + service.time.duration * 60000)),
    distanceFromPrevious: distance || 0,
    travelTimeFromPrevious: distance ? calculateTravelTime(distance) : 15,
    previousService: previousService.id,
  }

  // Calculate shift metrics
  const shiftStart = Math.min(
    ...newShift.map(s => new Date(s.start).getTime()),
    new Date(serviceToAdd.start).getTime(),
  )
  const shiftEndTime = Math.max(
    ...newShift.map(s => new Date(s.end).getTime()),
    new Date(serviceToAdd.end).getTime(),
  )
  const duration = (shiftEndTime - shiftStart) / (60 * 1000)

  if (duration > SHIFT_DURATION) {
    return { success: false, shift: currentShift, score: 0 }
  }

  // Check time conflicts
  for (const existing of newShift) {
    if (
      checkTimeOverlap(
        new Date(existing.start),
        new Date(existing.end),
        nextStart,
        new Date(serviceToAdd.end),
      )
    ) {
      return { success: false, shift: currentShift, score: 0 }
    }
  }

  // Check distances between all services
  for (const existing of newShift) {
    const distance = distanceMatrix[existing.originalIndex][nextService.originalIndex]
    if (!distance || distance > HARD_MAX_RADIUS_MILES) {
      return { success: false, shift: currentShift, score: 0 }
    }
  }

  // Calculate shift quality score
  const averageDistance = calculateAverageDistance([...newShift, serviceToAdd], distanceMatrix)
  const timeGaps = calculateTimeGaps([...newShift, serviceToAdd])
  const utilization = duration / SHIFT_DURATION

  const distanceScore = 1 - averageDistance / HARD_MAX_RADIUS_MILES
  const gapScore = 1 - Math.min(timeGaps / 120, 1)
  const utilizationScore = Math.min(utilization / 0.85, 1) // Target 85% utilization

  const score = distanceScore * 0.4 + gapScore * 0.3 + utilizationScore * 0.3

  newShift.push(serviceToAdd)
  return { success: true, shift: newShift, score }
}

function checkTimeOverlap(start1, end1, start2, end2) {
  return start1 < end2 && end1 > start2
}

function createShiftsForUngrouped(services, distanceMatrix) {
  const shifts = []
  let currentShift = []
  let shiftEnd = null

  for (const service of services) {
    if (currentShift.length === 0) {
      // Start new shift
      const serviceStart = new Date(service.time.range[0])
      currentShift.push({
        ...service,
        start: serviceStart.toISOString(),
        end: new Date(serviceStart.getTime() + service.time.duration * 60000).toISOString(),
      })
      shiftEnd = new Date(serviceStart.getTime() + SHIFT_DURATION * 60000)
      continue
    }

    // Try to extend current shift
    const result = tryExtendShift(service, [], currentShift, distanceMatrix, shiftEnd)

    if (result.success) {
      currentShift = result.shift
    } else {
      // Start new shift
      shifts.push(currentShift)
      currentShift = []
      const serviceStart = new Date(service.time.range[0])
      currentShift.push({
        ...service,
        start: serviceStart.toISOString(),
        end: new Date(serviceStart.getTime() + service.time.duration * 60000).toISOString(),
      })
      shiftEnd = new Date(serviceStart.getTime() + SHIFT_DURATION * 60000)
    }
  }

  if (currentShift.length > 0) {
    shifts.push(currentShift)
  }

  return shifts
}

function calculateShiftEnd(service) {
  const start = new Date(service.time.range[0])
  return new Date(start.getTime() + SHIFT_DURATION * 60000)
}

function groupServicesByProximity(services, distanceMatrix) {
  const groups = []
  const visited = new Set()

  for (const service of services) {
    if (visited.has(service.originalIndex)) continue

    const group = [service]
    visited.add(service.originalIndex)

    // Find nearby services with compatible time windows
    for (const candidate of services) {
      if (visited.has(candidate.originalIndex)) continue

      const distance = distanceMatrix[service.originalIndex][candidate.originalIndex]
      if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

      const timeCompatible = checkTimeWindowCompatibility(service, candidate)
      if (timeCompatible) {
        group.push(candidate)
        visited.add(candidate.originalIndex)
      }
    }

    if (group.length > 0) {
      // Sort group by time window start and flexibility
      group.sort((a, b) => {
        const aStart = new Date(a.time.range[0])
        const bStart = new Date(b.time.range[0])
        const timeCompare = aStart - bStart
        if (timeCompare !== 0) return timeCompare

        const aFlex = new Date(a.time.range[1]) - aStart
        const bFlex = new Date(b.time.range[1]) - bStart
        return bFlex - aFlex // More flexible windows first
      })

      groups.push(group)
    }
  }

  // Sort groups by size (descending) and earliest start time
  groups.sort((a, b) => {
    const sizeCompare = b.length - a.length
    if (sizeCompare !== 0) return sizeCompare

    const aStart = new Date(a[0].time.range[0])
    const bStart = new Date(b[0].time.range[0])
    return aStart - bStart
  })

  return groups
}

function findBestBacktrackPoint(points, remaining, distanceMatrix) {
  let bestPoint = null
  let bestScore = -Infinity

  for (const point of points) {
    const score = evaluateBacktrackPoint(point, remaining, distanceMatrix)
    if (score > bestScore) {
      bestScore = score
      bestPoint = point
    }
  }

  return bestScore > 0 ? bestPoint : null
}

function evaluateBacktrackPoint(point, remaining, distanceMatrix) {
  const { shift, remaining: pointRemaining, score: baseScore } = point

  // Calculate potential for combining remaining services
  let potentialScore = 0
  const lastService = shift[shift.length - 1]

  for (const service of remaining) {
    if (pointRemaining.some(s => s.originalIndex === service.originalIndex)) {
      const distance = distanceMatrix[lastService.originalIndex][service.originalIndex]
      if (distance && distance <= HARD_MAX_RADIUS_MILES) {
        const timeCompatible = checkTimeWindowCompatibility(lastService, service)
        if (timeCompatible) {
          potentialScore += 0.1
        }
      }
    }
  }

  return baseScore + potentialScore
}

function checkTimeWindowCompatibility(service1, service2) {
  const start1 = new Date(service1.time.range[0])
  const end1 = new Date(service1.time.range[1])
  const start2 = new Date(service2.time.range[0])
  const end2 = new Date(service2.time.range[1])

  // Check if time windows overlap
  return start1 <= end2 && end1 >= start2
}

function selectBestShifts(candidates, distanceMatrix) {
  return candidates.filter(shift => {
    // Calculate shift metrics
    const totalDuration = calculateShiftDuration(shift)
    const averageDistance = calculateAverageDistance(shift, distanceMatrix)
    const timeGaps = calculateTimeGaps(shift)

    // Accept shift if it meets criteria
    return (
      totalDuration <= SHIFT_DURATION &&
      averageDistance <= HARD_MAX_RADIUS_MILES * 0.8 &&
      timeGaps <= 120
    )
  })
}

function calculateShiftDuration(shift) {
  if (shift.length === 0) return 0
  const start = Math.min(...shift.map(s => new Date(s.start).getTime()))
  const end = Math.max(...shift.map(s => new Date(s.end).getTime()))
  return (end - start) / (60 * 1000)
}

function calculateAverageDistance(shift, distanceMatrix) {
  if (shift.length < 2) return 0
  let totalDistance = 0
  let count = 0

  for (let i = 0; i < shift.length - 1; i++) {
    const distance = distanceMatrix[shift[i].originalIndex][shift[i + 1].originalIndex]
    if (distance) {
      totalDistance += distance
      count++
    }
  }

  return count > 0 ? totalDistance / count : Infinity
}

function calculateTimeGaps(shift) {
  if (shift.length < 2) return 0
  let maxGap = 0

  for (let i = 0; i < shift.length - 1; i++) {
    const currentEnd = new Date(shift[i].end)
    const nextStart = new Date(shift[i + 1].start)
    const gap = (nextStart - currentEnd) / (60 * 1000)
    maxGap = Math.max(maxGap, gap)
  }

  return maxGap
}

parentPort.on('message', async ({ services, distanceMatrix }) => {
  const startTime = performance.now()

  try {
    const shifts = createShifts(services, distanceMatrix)

    // Flatten all services from all shifts
    const clusteredServices = shifts.flatMap(shift => shift.services)

    const endTime = performance.now()
    const duration = endTime - startTime

    const clusteringInfo = {
      algorithm: 'shifts',
      performanceDuration: Number.parseInt(duration),
      connectedPointsCount: services.length,
      outlierCount: 0,
      totalClusters: shifts.length,
      clusterSizes: shifts.map(shift => shift.services.length),
      clusterDistribution: shifts.map((shift, index) => ({
        [index]: shift.services.length,
      })),
      shifts: shifts.map(shift => ({
        startTime: shift.startTime,
        endTime: shift.endTime,
        serviceCount: shift.services.length,
      })),
    }

    parentPort.postMessage({
      clusteredServices,
      clusteringInfo,
    })
  } catch (error) {
    console.error('Error in clustering worker:', error)
    parentPort.postMessage({
      error: error.message,
      clusteringInfo: {
        algorithm: 'shifts',
      },
    })
  }
})

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
