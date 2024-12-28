import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough, getBorough } from '../../utils/boroughs.js'
import {
  MAX_RADIUS_MILES,
  HARD_MAX_RADIUS_MILES,
  SHIFT_DURATION,
  ENFORCE_BOROUGH_BOUNDARIES,
  TECH_SPEED_MPH,
} from '../../utils/constants.js'

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

  for (const service of remainingServices) {
    const distance = distanceMatrix[currentIndex][service.originalIndex]

    // Strict enforcement of distance caps
    if (distance > HARD_MAX_RADIUS_MILES) continue
    if (
      distance > MAX_RADIUS_MILES &&
      !areSameBorough(
        currentService.location.latitude,
        currentService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      )
    )
      continue

    const travelTime = calculateTravelTime(distanceMatrix, currentIndex, service.originalIndex)

    // Skip if travel time is too long
    if (travelTime > MAX_TRAVEL_TIME) continue

    // Get the valid time range for this service
    const rangeStart = new Date(service.time.range[0])
    const rangeEnd = new Date(service.time.range[1])

    // Start trying from the earliest possible time after current service
    let tryStart = new Date(
      Math.max(rangeStart.getTime(), new Date(currentService.end).getTime() + travelTime * 60000),
    )

    // Keep trying different start times within the service's allowed range
    while (tryStart <= rangeEnd) {
      tryStart = roundToNearestInterval(tryStart)

      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
      if (serviceEnd > shiftEnd) break

      // Check for conflicts with scheduled services
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
        const timeGap = (tryStart - new Date(currentService.end)) / 60000
        const distanceScore =
          distance > MAX_RADIUS_MILES
            ? -999999 // Make it impossible to cluster services beyond MAX_RADIUS_MILES
            : -Math.pow(distance, 1.5) // Stronger penalty for distance
        const timeGapScore = -timeGap / 4
        const score = distanceScore + timeGapScore

        if (score > bestScore) {
          bestScore = score
          bestService = service
          bestStart = tryStart
        }
        break
      }

      tryStart = new Date(tryStart.getTime() + TIME_INCREMENT * 60000)
    }
  }

  return bestService ? { service: bestService, start: bestStart } : null
}

function canAddServiceToShift(service, shift, distanceMatrix) {
  // Check if service can be added to any existing service in the shift
  for (const existingService of shift.services) {
    const next = findBestNextService(
      existingService,
      [service],
      distanceMatrix,
      shift.endTime,
      shift.services,
    )
    if (next) return { next, existingService } // Return the match info
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
    if (distance > HARD_MAX_RADIUS_MILES) return false
    if (
      distance > MAX_RADIUS_MILES &&
      !areSameBorough(
        existingService.location.latitude,
        existingService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      )
    )
      return false
  }

  // Also verify all existing services against each other
  for (let i = 0; i < shift.services.length; i++) {
    for (let j = i + 1; j < shift.services.length; j++) {
      const distance =
        distanceMatrix[shift.services[i].originalIndex][shift.services[j].originalIndex]
      if (distance > HARD_MAX_RADIUS_MILES) return false
      if (
        distance > MAX_RADIUS_MILES &&
        !areSameBorough(
          shift.services[i].location.latitude,
          shift.services[i].location.longitude,
          shift.services[j].location.latitude,
          shift.services[j].location.longitude,
        )
      )
        return false
    }
  }
  return true
}

function createShifts(services, distanceMatrix, maxPoints = 14) {
  // Sort all services by start time, then by time window duration
  const sortedServices = services
    .map((service, index) => ({
      ...service,
      originalIndex: index,
      borough: getBorough(service.location.latitude, service.location.longitude),
      timeWindow: new Date(service.time.range[1]) - new Date(service.time.range[0]),
    }))
    .sort((a, b) => {
      const timeCompare = new Date(a.time.range[0]) - new Date(b.time.range[0])
      if (timeCompare !== 0) return timeCompare
      return a.timeWindow - b.timeWindow
    })

  let clusterIndex = 0
  const shifts = []

  for (const service of sortedServices) {
    let bestShift = null
    let bestStart = null
    let bestScore = -Infinity
    const serviceBorough = service.borough

    // Try all existing shifts in order of best fit
    const compatibleShifts = shifts
      .filter(s => {
        if (s.services.length >= maxPoints) return false
        if (ENFORCE_BOROUGH_BOUNDARIES && s.services[0].borough !== serviceBorough) return false

        // Check distance to ALL services in the shift
        // If ANY service is too far, reject this shift entirely
        for (const existingService of s.services) {
          const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
          if (distance > HARD_MAX_RADIUS_MILES) return false
          if (
            distance > MAX_RADIUS_MILES &&
            !areSameBorough(
              existingService.location.latitude,
              existingService.location.longitude,
              service.location.latitude,
              service.location.longitude,
            )
          )
            return false
        }
        return true
      })
      .sort((a, b) => {
        const aStart = Math.min(...a.services.map(s => new Date(s.start).getTime()))
        const bStart = Math.min(...b.services.map(s => new Date(s.start).getTime()))
        const serviceStart = new Date(service.time.range[0]).getTime()

        // Calculate maximum distance to any service in the shift
        const aMaxDist = Math.max(
          ...a.services.map(s => distanceMatrix[s.originalIndex][service.originalIndex]),
        )
        const bMaxDist = Math.max(
          ...b.services.map(s => distanceMatrix[s.originalIndex][service.originalIndex]),
        )

        // Heavily penalize distances beyond MAX_RADIUS_MILES
        const aDistScore = aMaxDist > MAX_RADIUS_MILES ? 999999 : aMaxDist
        const bDistScore = bMaxDist > MAX_RADIUS_MILES ? 999999 : bMaxDist

        const aScore = Math.abs(aStart - serviceStart) / 3600000 + aDistScore * 2
        const bScore = Math.abs(bStart - serviceStart) / 3600000 + bDistScore * 2
        return aScore - bScore
      })

    // Try each compatible shift
    for (const shift of compatibleShifts) {
      const shiftStartTime = Math.min(...shift.services.map(s => new Date(s.start).getTime()))
      const shiftEndTime = Math.max(...shift.services.map(s => new Date(s.end).getTime()))

      // Try each existing service as a potential connection point
      for (const existingService of shift.services) {
        // Skip if too far - strict enforcement
        const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
        if (distance > HARD_MAX_RADIUS_MILES) continue

        // Skip if this would violate soft cap and services are in different boroughs
        if (
          distance > MAX_RADIUS_MILES &&
          !areSameBorough(
            existingService.location.latitude,
            existingService.location.longitude,
            service.location.latitude,
            service.location.longitude,
          )
        )
          continue

        // Calculate actual travel time needed
        const travelTime = calculateTravelTime(
          distanceMatrix,
          existingService.originalIndex,
          service.originalIndex,
        )

        // Try to schedule after this service with actual travel time
        const tryStart = new Date(
          Math.max(
            new Date(service.time.range[0]).getTime(),
            new Date(existingService.end).getTime() + travelTime * 60000,
          ),
        )
        const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

        // Calculate what the shift duration would be if we add this service
        const newShiftStart = Math.min(shiftStartTime, tryStart.getTime())
        const newShiftEnd = Math.max(shiftEndTime, tryEnd.getTime())
        const newShiftDuration = (newShiftEnd - newShiftStart) / (60 * 1000)

        // Skip if this would make the shift too long
        if (newShiftDuration > SHIFT_DURATION) continue

        let hasConflict = false
        for (const other of shift.services) {
          if (checkTimeOverlap(new Date(other.start), new Date(other.end), tryStart, tryEnd)) {
            hasConflict = true
            break
          }
        }

        if (!hasConflict) {
          const timeGap = (tryStart.getTime() - new Date(existingService.end).getTime()) / 60000
          // Increase distance penalty to prefer closer services
          const score = -Math.pow(distance, 1.5) - Math.pow(timeGap, 0.5)

          if (score > bestScore) {
            bestScore = score
            bestShift = shift
            bestStart = tryStart
          }
        }
      }
    }

    // Add to best existing shift or create new one
    if (bestShift && bestStart) {
      // Verify all distances one final time before adding
      const serviceToAdd = {
        ...service,
        cluster: bestShift.cluster,
        start: bestStart.toISOString(),
        end: new Date(bestStart.getTime() + service.time.duration * 60000).toISOString(),
        originalIndex: service.originalIndex,
      }

      if (verifyShiftDistances(bestShift, serviceToAdd, distanceMatrix)) {
        bestShift.services.push(serviceToAdd)
      } else {
        // If verification fails, create a new shift instead
        const newShift = createNewShift(service, clusterIndex++)
        shifts.push(newShift)
      }
    } else {
      const newShift = createNewShift(service, clusterIndex++)
      shifts.push(newShift)
    }
  }

  return shifts
}

// Helper to calculate bonus for overlapping time windows
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

  return maxOverlap / 10 // Convert to score bonus
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
