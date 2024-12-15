import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough, getBorough } from '../../utils/boroughs.js'

const SHIFT_DURATION = 8 * 60 // 8 hours in minutes
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
  return distance ? Math.ceil(distance * 2) : MAX_TRAVEL_TIME // Assume 30 mph average speed
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
  const MAX_REASONABLE_DISTANCE = 5

  for (const service of remainingServices) {
    const travelTime = calculateTravelTime(distanceMatrix, currentIndex, service.originalIndex)
    const distance = distanceMatrix[currentIndex][service.originalIndex]

    // Skip services that are too far away or in different boroughs
    if (distance > MAX_REASONABLE_DISTANCE) continue
    if (
      !areSameBorough(
        currentService.location.latitude,
        currentService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      )
    )
      continue

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
        const distanceScore = -Math.pow(distance, 2)
        const timeGapScore = -timeGap / 4 // (was -travelTime - timeGap / 2)
        const score = distanceScore + timeGapScore

        if (score > bestScore) {
          bestScore = score
          bestService = service
          bestStart = tryStart
        }
        break // Found a valid time slot, no need to keep trying
      }

      // Try next 15-minute increment
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
      // First by start time
      const timeCompare = new Date(a.time.range[0]) - new Date(b.time.range[0])
      if (timeCompare !== 0) return timeCompare
      // Then by time window (shorter windows first)
      return a.timeWindow - b.timeWindow
    })

  let clusterIndex = 0
  const shifts = []

  // Try to schedule each service
  for (const service of sortedServices) {
    let bestShift = null
    let bestStart = null
    let bestScore = -Infinity
    const serviceBorough = service.borough

    // Try to add to existing shifts in same borough
    for (const shift of shifts) {
      // Skip if different borough or shift is full
      if (shift.services[0].borough !== serviceBorough || shift.services.length >= maxPoints)
        continue

      // Try each existing service as a potential connection point
      for (const existingService of shift.services) {
        // Skip if too far or different borough
        const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
        if (distance > 5) continue

        // Try to schedule after this service
        const earliestStart = Math.max(
          new Date(service.time.range[0]).getTime(),
          new Date(existingService.end).getTime() + 15 * 60000, // 15 min buffer
        )
        const latestStart =
          new Date(service.time.range[1]).getTime() - service.time.duration * 60000

        if (earliestStart <= latestStart) {
          const tryStart = new Date(earliestStart)
          const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
          let hasConflict = false

          // Check for conflicts with other services in shift
          for (const other of shift.services) {
            if (checkTimeOverlap(new Date(other.start), new Date(other.end), tryStart, tryEnd)) {
              hasConflict = true
              break
            }
          }

          if (!hasConflict) {
            // Score based on time gap and distance
            const timeGap = (tryStart.getTime() - new Date(existingService.end).getTime()) / 60000
            const score = -Math.pow(distance, 1.2) - Math.pow(timeGap, 0.5)

            if (score > bestScore) {
              bestScore = score
              bestShift = shift
              bestStart = tryStart
            }
          }
        }
      }
    }

    // Add to best existing shift or create new one
    if (bestShift && bestStart) {
      bestShift.services.push({
        ...service,
        cluster: bestShift.cluster,
        start: bestStart.toISOString(),
        end: new Date(bestStart.getTime() + service.time.duration * 60000).toISOString(),
      })
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
    // Create optimized 8-hour shifts
    const shifts = createShifts(services, distanceMatrix)

    // Flatten all services from all shifts
    const clusteredServices = shifts.flatMap((shift) => shift.services)

    const endTime = performance.now()
    const duration = endTime - startTime

    const clusteringInfo = {
      algorithm: 'shifts',
      performanceDuration: Number.parseInt(duration),
      connectedPointsCount: services.length,
      outlierCount: 0,
      totalClusters: shifts.length,
      clusterSizes: shifts.map((shift) => shift.services.length),
      clusterDistribution: shifts.map((shift, index) => ({
        [index]: shift.services.length,
      })),
      shifts: shifts.map((shift) => ({
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
