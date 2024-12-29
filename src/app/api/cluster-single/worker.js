import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough, getBorough } from '../../utils/boroughs.js'
import {
  MAX_RADIUS_MILES_ACROSS_BOROUGHS,
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

  // First, calculate time flexibility for all remaining services
  const serviceFlexibility = remainingServices.map(service => {
    const rangeStart = new Date(service.time.range[0])
    const rangeEnd = new Date(service.time.range[1])
    return {
      service,
      flexibility: (rangeEnd - rangeStart) / (60 * 1000), // flexibility in minutes
      duration: service.time.duration,
    }
  })

  // Sort by flexibility to prioritize less flexible services
  serviceFlexibility.sort((a, b) => {
    // First compare by flexibility
    const flexDiff = a.flexibility - b.flexibility
    if (flexDiff !== 0) return flexDiff
    // If flexibility is the same, prefer shorter duration services
    return a.duration - b.duration
  })

  for (const { service, flexibility, duration } of serviceFlexibility) {
    const distance = distanceMatrix[currentIndex][service.originalIndex]

    // Check hard distance cap
    if (distance > HARD_MAX_RADIUS_MILES) continue

    // Check distances between this service and ALL scheduled services
    let hasDistanceViolation = false
    for (const scheduled of scheduledServices) {
      const scheduledDistance = distanceMatrix[scheduled.originalIndex][service.originalIndex]
      if (scheduledDistance > HARD_MAX_RADIUS_MILES) {
        hasDistanceViolation = true
        break
      }
      // Check borough boundaries for MAX_RADIUS_MILES_ACROSS_BOROUGHS
      if (
        scheduledDistance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
        !areSameBorough(
          scheduled.location.latitude,
          scheduled.location.longitude,
          service.location.latitude,
          service.location.longitude,
        )
      ) {
        hasDistanceViolation = true
        break
      }
    }
    if (hasDistanceViolation) continue

    // Calculate if there are closer services with tighter time windows
    const closerServicesWithTighterWindows = remainingServices.filter(other => {
      if (other === service) return false
      const otherDistance = distanceMatrix[currentIndex][other.originalIndex]
      if (otherDistance >= distance) return false

      const otherStart = new Date(other.time.range[0])
      const otherEnd = new Date(other.time.range[1])
      const otherFlexibility = (otherEnd - otherStart) / (60 * 1000)

      // Only consider services that would be valid for the current shift
      const travelTime = calculateTravelTime(distanceMatrix, currentIndex, other.originalIndex)
      const earliestStart = new Date(currentService.end)
      earliestStart.setMinutes(earliestStart.getMinutes() + travelTime)

      return (
        otherFlexibility < flexibility &&
        otherEnd >= earliestStart &&
        otherDistance <= HARD_MAX_RADIUS_MILES
      )
    })

    const travelTime = calculateTravelTime(distanceMatrix, currentIndex, service.originalIndex)
    if (travelTime > MAX_TRAVEL_TIME) continue

    const rangeStart = new Date(service.time.range[0])
    const rangeEnd = new Date(service.time.range[1])
    let tryStart = new Date(
      Math.max(rangeStart.getTime(), new Date(currentService.end).getTime() + travelTime * 60000),
    )

    while (tryStart <= rangeEnd) {
      tryStart = roundToNearestInterval(tryStart)
      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
      if (serviceEnd > shiftEnd) break

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

        // Distance scoring based on borough boundaries
        let distanceScore
        if (
          distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
          !areSameBorough(
            currentService.location.latitude,
            currentService.location.longitude,
            service.location.latitude,
            service.location.longitude,
          )
        ) {
          distanceScore = -999999 // Strongly discourage exceeding MAX_RADIUS_MILES_ACROSS_BOROUGHS between boroughs
        } else {
          distanceScore = -Math.pow(distance, 2) // Normal distance penalty within borough
        }

        // Time window flexibility penalty - reduced for short duration services
        const flexibilityScore = -Math.log(flexibility + 1) * (duration > 30 ? 2 : 1)

        // Increased penalty for having closer services with tighter windows
        const lookaheadPenalty = closerServicesWithTighterWindows.length * -20

        // Time gap penalty - reduced for flexible services
        const timeGapScore = -Math.pow(timeGap / (flexibility > 120 ? 60 : 30), 1.5)

        // Bonus for short duration services with flexible windows
        const shortServiceBonus = duration <= 30 && flexibility > 120 ? 20 : 0

        // Combined score with higher weight on lookahead and short service bonus
        const score =
          distanceScore + flexibilityScore + timeGapScore + lookaheadPenalty + shortServiceBonus

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
  // First verify that the service can be added without violating distance constraints
  for (const existingService of shift.services) {
    const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
    if (distance > HARD_MAX_RADIUS_MILES) return false
    if (
      distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
      !areSameBorough(
        existingService.location.latitude,
        existingService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      )
    )
      return false
  }

  // Then check if it can be scheduled after any existing service
  for (const existingService of shift.services) {
    const next = findBestNextService(
      existingService,
      [service],
      distanceMatrix,
      shift.endTime,
      shift.services,
    )
    if (next) return { next, existingService }
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
      distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
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
        distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
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
        for (const existingService of s.services) {
          const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
          if (distance > HARD_MAX_RADIUS_MILES) return false
          if (
            distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
            !areSameBorough(
              existingService.location.latitude,
              existingService.location.longitude,
              service.location.latitude,
              service.location.longitude,
            )
          )
            return false
        }

        // Calculate actual shift duration if we were to add this service
        const shiftStartTime = Math.min(
          ...s.services.map(s => new Date(s.start).getTime()),
          new Date(service.time.range[0]).getTime(),
        )
        const shiftEndTime = Math.max(
          ...s.services.map(s => new Date(s.end).getTime()),
          new Date(service.time.range[1]).getTime(),
        )
        const shiftDuration = (shiftEndTime - shiftStartTime) / (60 * 60 * 1000) // in hours

        // Allow shifts up to 8 hours with no penalty until 7 hours
        return shiftDuration <= 8
      })
      .sort((a, b) => {
        const aServices = a.services
        const bServices = b.services

        // Calculate average distances
        const aAvgDist =
          aServices.reduce(
            (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
            0,
          ) / aServices.length
        const bAvgDist =
          bServices.reduce(
            (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
            0,
          ) / bServices.length

        // Calculate time gaps
        const aLastEnd = Math.max(...aServices.map(s => new Date(s.end).getTime()))
        const bLastEnd = Math.max(...bServices.map(s => new Date(s.end).getTime()))
        const serviceStart = new Date(service.time.range[0]).getTime()
        const aTimeGap = Math.max(0, (serviceStart - aLastEnd) / (60 * 1000)) // in minutes
        const bTimeGap = Math.max(0, (serviceStart - bLastEnd) / (60 * 1000)) // in minutes

        // Calculate shift durations
        const aShiftDuration =
          (aLastEnd - Math.min(...aServices.map(s => new Date(s.start).getTime()))) /
          (60 * 60 * 1000)
        const bShiftDuration =
          (bLastEnd - Math.min(...bServices.map(s => new Date(s.start).getTime()))) /
          (60 * 60 * 1000)

        // Score based on distance and time gap
        // More lenient with time gaps (up to 3 hours) if distances are good
        // Prefer shifts that are already longer (up to 7 hours) to maximize route efficiency
        const aScore =
          aAvgDist * 2 + // Distance weight reduced
          Math.min(180, aTimeGap) / 60 + // More tolerant of time gaps
          Math.max(0, aShiftDuration - 7) * 10 // Only penalize shifts over 7 hours
        const bScore =
          bAvgDist * 2 + Math.min(180, bTimeGap) / 60 + Math.max(0, bShiftDuration - 7) * 10

        return aScore - bScore
      })

    // Try each compatible shift
    for (const shift of compatibleShifts) {
      const shiftStartTime = Math.min(...shift.services.map(s => new Date(s.start).getTime()))
      const shiftEndTime = Math.max(...shift.services.map(s => new Date(s.end).getTime()))

      // Try each existing service as a potential connection point
      for (const existingService of shift.services) {
        const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
        if (distance > HARD_MAX_RADIUS_MILES) continue

        if (
          distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS &&
          !areSameBorough(
            existingService.location.latitude,
            existingService.location.longitude,
            service.location.latitude,
            service.location.longitude,
          )
        )
          continue

        const travelTime = calculateTravelTime(
          distanceMatrix,
          existingService.originalIndex,
          service.originalIndex,
        )

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
        const newShiftDuration = (newShiftEnd - newShiftStart) / (60 * 1000) // in minutes

        // Allow up to 8 hours (480 minutes)
        if (newShiftDuration > 480) continue

        let hasConflict = false
        for (const other of shift.services) {
          if (checkTimeOverlap(new Date(other.start), new Date(other.end), tryStart, tryEnd)) {
            hasConflict = true
            break
          }
        }

        if (!hasConflict) {
          const timeGap = (tryStart.getTime() - new Date(existingService.end).getTime()) / 60000

          // Calculate average distance to all services in the shift
          const avgDistance =
            shift.services.reduce(
              (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
              0,
            ) / shift.services.length

          // Score calculation:
          // - Distance penalty reduced
          // - Much more tolerant of time gaps (up to 3 hours)
          // - Only penalize shift duration over 7 hours
          const distanceScore = -Math.pow(avgDistance, 1.2) // Reduced penalty
          const timeGapScore = -Math.pow(Math.min(180, timeGap) / 120, 1.1) // More tolerant of gaps
          const durationScore = -Math.pow(Math.max(0, newShiftDuration - 420) / 60, 2) // Only penalize after 7 hours

          // Bonus for filling up shifts (up to 7 hours)
          const utilizationBonus = Math.min(newShiftDuration, 420) / 60

          const score = distanceScore + timeGapScore + durationScore + utilizationBonus

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
