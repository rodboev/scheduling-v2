import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough, getBorough } from '@/app/utils/boroughs.js'
import {
  MAX_RADIUS_MILES_ACROSS_BOROUGHS,
  HARD_MAX_RADIUS_MILES,
  SHIFT_DURATION,
  ENFORCE_BOROUGH_BOUNDARIES,
  TECH_SPEED_MPH,
} from '@/app/utils/constants.js'

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

    const travelTime = calculateTravelTime(distanceMatrix, currentIndex, service.originalIndex)
    const rangeStart = new Date(service.time.range[0])
    const rangeEnd = new Date(service.time.range[1])
    let tryStart = new Date(
      Math.max(rangeStart.getTime(), currentEnd.getTime() + travelTime * 60000),
    )

    // Be more lenient with time gaps for shorter shifts
    const maxTimeGap = shiftDuration < 240 ? 180 : 120 // Allow up to 3-hour gaps for shifts under 4 hours

    while (tryStart <= rangeEnd) {
      tryStart = roundToNearestInterval(tryStart)
      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

      // Check if adding this service would exceed 8 hours
      const newShiftDuration =
        (Math.max(serviceEnd.getTime(), currentEnd.getTime()) - shiftStart) / (60 * 1000)
      if (newShiftDuration > 480) break

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
        const timeGap = (tryStart - currentEnd) / (60 * 1000)
        if (timeGap > maxTimeGap) {
          tryStart = new Date(tryStart.getTime() + TIME_INCREMENT * 60000)
          continue
        }

        // Enhanced scoring system
        const distanceScore = -Math.pow(distance / HARD_MAX_RADIUS_MILES, 2) * 50
        const timeGapScore = -Math.pow(timeGap / 60, 1.5) // Less penalty for time gaps
        const durationBonus = Math.min(newShiftDuration, 480) / 60 // Bonus for longer shifts
        const flexibilityPenalty = -Math.log((rangeEnd - rangeStart) / (60 * 60 * 1000))

        const score = distanceScore + timeGapScore + durationBonus + flexibilityPenalty

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

function tryExtendShift(shift, remainingServices, distanceMatrix) {
  const currentDuration =
    (Math.max(...shift.services.map(s => new Date(s.end).getTime())) -
      Math.min(...shift.services.map(s => new Date(s.start).getTime()))) /
    (60 * 1000)

  if (currentDuration >= 480) return false // Already at max duration

  // Try to find services that can extend the shift
  const lastService = shift.services[shift.services.length - 1]
  const compatibleServices = findCompatibleServices(
    lastService,
    remainingServices,
    distanceMatrix,
    shift.services,
  )

  for (const { service } of compatibleServices) {
    const tryStart = new Date(
      Math.max(
        new Date(service.time.range[0]).getTime(),
        new Date(lastService.end).getTime() +
          calculateTravelTime(distanceMatrix, lastService.originalIndex, service.originalIndex) *
            60000,
      ),
    )
    const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

    // Calculate new shift duration
    const newShiftStart = Math.min(
      ...shift.services.map(s => new Date(s.start).getTime()),
      tryStart.getTime(),
    )
    const newShiftEnd = Math.max(
      ...shift.services.map(s => new Date(s.end).getTime()),
      tryEnd.getTime(),
    )
    const newDuration = (newShiftEnd - newShiftStart) / (60 * 1000)

    if (newDuration <= 480) {
      // Check for time conflicts
      let hasConflict = false
      for (const existing of shift.services) {
        if (checkTimeOverlap(new Date(existing.start), new Date(existing.end), tryStart, tryEnd)) {
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        const serviceToAdd = {
          ...service,
          cluster: shift.cluster,
          start: tryStart.toISOString(),
          end: tryEnd.toISOString(),
        }

        if (verifyShiftDistances(shift, serviceToAdd, distanceMatrix)) {
          shift.services.push(serviceToAdd)
          return true
        }
      }
    }
  }

  return false
}

function createShifts(services, distanceMatrix, maxPoints = 14) {
  // Sort by time window and start time, but prioritize services with overlapping windows
  const sortedServices = services
    .map((service, index) => ({
      ...service,
      originalIndex: index,
      borough: getBorough(service.location.latitude, service.location.longitude),
      timeWindow: new Date(service.time.range[1]) - new Date(service.time.range[0]),
      startTime: new Date(service.time.range[0]),
      endTime: new Date(service.time.range[1]),
    }))
    .sort((a, b) => {
      // First group by rough time periods (morning/afternoon)
      const aPeriod = Math.floor(a.startTime.getHours() / 4)
      const bPeriod = Math.floor(b.startTime.getHours() / 4)
      if (aPeriod !== bPeriod) return aPeriod - bPeriod

      // Then by time window flexibility
      return a.timeWindow - b.timeWindow
    })

  let clusterIndex = 0
  const shifts = []
  let remainingServices = [...sortedServices]

  // First pass: Create initial shifts with anchor services
  while (remainingServices.length > 0) {
    const service = remainingServices[0]
    let bestShift = null
    let bestStart = null
    let bestScore = -Infinity

    // Try to add to existing shifts first
    for (const shift of shifts) {
      if (shift.services.length >= maxPoints) continue

      const shiftStartTime = Math.min(...shift.services.map(s => new Date(s.start).getTime()))
      const shiftEndTime = Math.max(...shift.services.map(s => new Date(s.end).getTime()))
      const currentDuration = (shiftEndTime - shiftStartTime) / (60 * 1000)

      // Be more lenient with shift duration - allow up to 8 hours
      if (currentDuration >= 480) continue

      // Find all possible start times within the service's time window
      const rangeStart = new Date(service.time.range[0])
      const rangeEnd = new Date(service.time.range[1])
      let tryStart = rangeStart

      while (tryStart <= rangeEnd) {
        const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
        const newShiftStart = Math.min(shiftStartTime, tryStart.getTime())
        const newShiftEnd = Math.max(shiftEndTime, tryEnd.getTime())
        const newDuration = (newShiftEnd - newShiftStart) / (60 * 1000)

        if (newDuration <= 480) {
          // Check distance and time constraints
          let isCompatible = true
          let hasTimeConflict = false

          for (const existing of shift.services) {
            // Check distance
            const distance = distanceMatrix[existing.originalIndex][service.originalIndex]
            if (!distance || distance > HARD_MAX_RADIUS_MILES) {
              isCompatible = false
              break
            }

            // More lenient borough boundary check
            if (distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS) {
              const sameBorough = areSameBorough(
                existing.location.latitude,
                existing.location.longitude,
                service.location.latitude,
                service.location.longitude,
              )
              if (!sameBorough && distance > HARD_MAX_RADIUS_MILES) {
                isCompatible = false
                break
              }
            }

            // Check time conflicts
            if (
              checkTimeOverlap(new Date(existing.start), new Date(existing.end), tryStart, tryEnd)
            ) {
              hasTimeConflict = true
              break
            }
          }

          if (isCompatible && !hasTimeConflict) {
            // Enhanced scoring system
            const timeWindowOverlap = getTimeWindowOverlapScore(service, shift.services)
            const durationScore = newDuration / 480 // Prefer fuller shifts
            const serviceCount = shift.services.length
            const countBonus = serviceCount / maxPoints // Prefer adding to shifts with more services
            const timeGapPenalty = -Math.abs(tryStart.getTime() - shiftEndTime) / (60 * 60 * 1000)
            const locationBonus = shift.services.some(
              s =>
                distanceMatrix[s.originalIndex][service.originalIndex] <
                MAX_RADIUS_MILES_ACROSS_BOROUGHS,
            )
              ? 2
              : 0

            const score =
              timeWindowOverlap + durationScore + countBonus + timeGapPenalty + locationBonus

            if (score > bestScore) {
              bestScore = score
              bestShift = shift
              bestStart = tryStart
            }
          }
        }

        tryStart = new Date(tryStart.getTime() + TIME_INCREMENT * 60000)
      }
    }

    if (bestShift && bestStart) {
      // Add to existing shift
      const serviceToAdd = {
        ...service,
        cluster: bestShift.cluster,
        start: bestStart.toISOString(),
        end: new Date(bestStart.getTime() + service.time.duration * 60000).toISOString(),
      }

      bestShift.services.push(serviceToAdd)
      remainingServices = remainingServices.filter(s => s.originalIndex !== service.originalIndex)

      // Try to extend the shift immediately
      let extended
      do {
        extended = tryExtendShift(bestShift, remainingServices, distanceMatrix)
        if (extended) {
          const lastAdded = bestShift.services[bestShift.services.length - 1]
          remainingServices = remainingServices.filter(
            s => s.originalIndex !== lastAdded.originalIndex,
          )
        }
      } while (extended && bestShift.services.length < maxPoints)
    } else {
      // Create new shift
      const newShift = createNewShift(service, clusterIndex++)
      shifts.push(newShift)
      remainingServices = remainingServices.filter(s => s.originalIndex !== service.originalIndex)

      // Try to fill the new shift immediately
      let extended
      do {
        extended = tryExtendShift(newShift, remainingServices, distanceMatrix)
        if (extended) {
          const lastAdded = newShift.services[newShift.services.length - 1]
          remainingServices = remainingServices.filter(
            s => s.originalIndex !== lastAdded.originalIndex,
          )
        }
      } while (extended && newShift.services.length < maxPoints)
    }
  }

  // More aggressive shift merging
  for (let i = shifts.length - 1; i >= 0; i--) {
    const shift = shifts[i]
    const shiftStart = Math.min(...shift.services.map(s => new Date(s.start).getTime()))
    const shiftEnd = Math.max(...shift.services.map(s => new Date(s.end).getTime()))
    const shiftDuration = (shiftEnd - shiftStart) / (60 * 1000)

    // Try to merge with other shifts, prioritizing shorter shifts
    for (let j = 0; j < i; j++) {
      const targetShift = shifts[j]
      if (targetShift.services.length + shift.services.length > maxPoints) continue

      const targetStart = Math.min(...targetShift.services.map(s => new Date(s.start).getTime()))
      const targetEnd = Math.max(...targetShift.services.map(s => new Date(s.end).getTime()))
      const targetDuration = (targetEnd - targetStart) / (60 * 1000)

      // Be more aggressive about merging if either shift is short
      const shouldTryMerge =
        shiftDuration < 240 || targetDuration < 240 || shiftDuration + targetDuration <= 480

      if (shouldTryMerge) {
        const mergedStart = Math.min(shiftStart, targetStart)
        const mergedEnd = Math.max(shiftEnd, targetEnd)
        const mergedDuration = (mergedEnd - mergedStart) / (60 * 1000)

        if (mergedDuration <= 480) {
          // Check compatibility with more lenient criteria
          let canMerge = true
          for (const service1 of shift.services) {
            for (const service2 of targetShift.services) {
              // Check time conflicts
              if (
                checkTimeOverlap(
                  new Date(service1.start),
                  new Date(service1.end),
                  new Date(service2.start),
                  new Date(service2.end),
                )
              ) {
                canMerge = false
                break
              }

              // Check distance with more lenient criteria
              const distance = distanceMatrix[service1.originalIndex][service2.originalIndex]
              if (!distance || distance > HARD_MAX_RADIUS_MILES) {
                canMerge = false
                break
              }

              // More lenient borough check for short shifts
              if (distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS) {
                const sameBorough = areSameBorough(
                  service1.location.latitude,
                  service1.location.longitude,
                  service2.location.latitude,
                  service2.location.longitude,
                )
                if (!sameBorough && distance > HARD_MAX_RADIUS_MILES) {
                  canMerge = false
                  break
                }
              }
            }
            if (!canMerge) break
          }

          if (canMerge) {
            // Merge shifts
            targetShift.services.push(
              ...shift.services.map(s => ({ ...s, cluster: targetShift.cluster })),
            )
            shifts.splice(i, 1)
            break
          }
        }
      }
    }
  }

  return shifts
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
