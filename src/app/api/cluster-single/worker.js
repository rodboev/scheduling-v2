import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough, getBorough } from '../../utils/boroughs.js'
import { dayjsInstance as dayjs } from '../../utils/dayjs.js'
import { logBoroughStats } from './logging.js'

const SHIFT_DURATION = 8 * 60 // 8 hours in minutes
const TIME_INCREMENT = 15
const MIN_SERVICES_PER_SHIFT = 2
const MAX_DISTANCE = 5
const MAX_TIME_BETWEEN = 120 // Allow 2 hours between services

function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  const start1 = dayjs(existingStart)
  const end1 = dayjs(existingEnd)
  const start2 = dayjs(newStart)
  const end2 = dayjs(newEnd)

  if (start2.isSame(end1) || start1.isSame(end2)) {
    return false
  }

  return (
    (start2.isBefore(end1) && start2.isSameOrAfter(start1)) ||
    (end2.isAfter(start1) && end2.isSameOrBefore(end1)) ||
    (start2.isSameOrBefore(start1) && end2.isSameOrAfter(end1))
  )
}

function getTimeWindowOverlap(service1, service2) {
  const start1 = service1.startTime
  const end1 = service1.endTime
  const start2 = service2.startTime
  const end2 = service2.endTime

  const overlapStart = dayjs.max(start1, start2)
  const overlapEnd = dayjs.min(end1, end2)

  return overlapEnd.isAfter(overlapStart) ? overlapEnd.diff(overlapStart, 'minute') : 0
}

function createNewShift(service, clusterIndex) {
  return {
    services: [
      {
        ...service,
        cluster: clusterIndex,
        start: service.startTime.toISOString(),
        end: service.endTime.toISOString(),
        visited: service.startTime.toISOString(),
      },
    ],
    startTime: service.startTime,
    endTime: service.endTime,
    cluster: clusterIndex,
  }
}

function hasConflicts(services, startTime, endTime) {
  return services.some((service) =>
    checkTimeOverlap(service.start, service.end, startTime.toISOString(), endTime.toISOString()),
  )
}

function findBestTimeSlot(shift, service, distanceMatrix) {
  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )

  let bestStart = null
  let bestScore = -Infinity

  // Try after each existing service
  for (const existing of sortedServices) {
    const distance = distanceMatrix[existing.originalIndex][service.originalIndex]
    if (distance > MAX_DISTANCE) continue

    // Try scheduling after with minimum gap
    const existingEndTime = new Date(existing.end)
    const earliestStart = new Date(existingEndTime.getTime() + TIME_INCREMENT * 60000)
    const latestStart = new Date(existingEndTime.getTime() + MAX_TIME_BETWEEN * 60000)

    // Try each possible start time
    for (
      let tryStart = new Date(earliestStart);
      tryStart < latestStart;
      tryStart = new Date(tryStart.getTime() + TIME_INCREMENT * 60000)
    ) {
      const tryEnd = new Date(tryStart.getTime() + service.time.duration * 60000)

      // Check if this fits within service's allowed window
      if (tryStart < service.startTime || tryStart > service.endTime) continue

      // Check shift duration constraint
      const shiftStart = Math.min(...sortedServices.map((s) => new Date(s.start).getTime()))
      const shiftEnd = Math.max(...sortedServices.map((s) => new Date(s.end).getTime()))
      const newShiftDuration =
        (Math.max(shiftEnd, tryEnd.getTime()) - Math.min(shiftStart, tryStart.getTime())) /
        (60 * 1000)

      if (newShiftDuration > SHIFT_DURATION) continue

      // Check for conflicts
      let hasConflict = false
      for (const other of sortedServices) {
        if (
          checkTimeOverlap(other.start, other.end, tryStart.toISOString(), tryEnd.toISOString())
        ) {
          hasConflict = true
          break
        }
      }

      if (!hasConflict) {
        // Score based on time gap and distance
        const timeGap = (tryStart.getTime() - new Date(existing.end).getTime()) / 60000
        const score = -Math.pow(distance, 1.2) - Math.pow(timeGap, 0.5)

        if (score > bestScore) {
          bestScore = score
          bestStart = tryStart
        }
      }
    }
  }

  return bestStart
}

function areServicesCompatible(service1, service2, distanceMatrix) {
  const distance = distanceMatrix[service1.originalIndex][service2.originalIndex]
  if (distance > MAX_DISTANCE) return false

  const start1 = service1.startTime
  const end1 = service1.endTime
  const start2 = service2.startTime
  const end2 = service2.endTime

  // Check for time window overlap
  const overlapStart = dayjs.max(start1, start2)
  const overlapEnd = dayjs.min(end1, end2)
  const hasOverlap = overlapEnd.isAfter(overlapStart)

  // If windows overlap, they're compatible
  if (hasOverlap) return true

  // If no overlap, check if they're close enough in time
  const gap = Math.min(Math.abs(end1.diff(start2, 'minute')), Math.abs(end2.diff(start1, 'minute')))

  return gap <= MAX_TIME_BETWEEN
}

function findCompatibleShifts(shifts, service, distanceMatrix, maxPoints) {
  const compatibleShifts = shifts
    .filter((s) => s.services[0].borough === service.borough && s.services.length < maxPoints)
    .sort((a, b) => {
      // Sort shifts by closest time and location
      const aStart = Math.min(...a.services.map((s) => new Date(s.start).getTime()))
      const bStart = Math.min(...b.services.map((s) => new Date(s.start).getTime()))
      const serviceStart = new Date(service.time.range[0]).getTime()

      // Calculate average distance to services in each shift
      const aAvgDist =
        a.services.reduce(
          (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
          0,
        ) / a.services.length
      const bAvgDist =
        b.services.reduce(
          (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
          0,
        ) / b.services.length

      // Score based on time proximity and average distance
      const aScore = Math.abs(aStart - serviceStart) / 3600000 + aAvgDist
      const bScore = Math.abs(bStart - serviceStart) / 3600000 + bAvgDist
      return aScore - bScore
    })

  return compatibleShifts
}

function parseServiceTimes(service) {
  try {
    // Parse time range
    const [start, end] = service.time.range
    const startTime = new Date(start)
    const endTime = new Date(end)

    // Validate parsed times
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      console.log('Invalid date parsing for service:', {
        company: service.company,
        timeRange: service.time.range,
      })
      return null
    }

    return {
      ...service,
      startTime,
      endTime,
      duration: service.time.duration,
      borough: getBorough(service.location.latitude, service.location.longitude),
    }
  } catch (error) {
    console.log('Error parsing service times:', {
      company: service.company,
      error: error.message,
    })
    return null
  }
}

function createShifts(services, distanceMatrix) {
  // Parse and validate service times first
  const validServices = services
    .map(parseServiceTimes)
    .filter(Boolean) // Remove any null results from invalid times
    .map((service, index) => ({
      ...service,
      originalIndex: index,
      timeWindow: service.endTime - service.startTime, // Use direct date subtraction
    }))
    .sort((a, b) => {
      // First by start time
      const timeCompare = a.startTime - b.startTime
      if (timeCompare !== 0) return timeCompare
      // Then by time window (shorter windows first)
      return a.timeWindow - b.timeWindow
    })

  let clusterIndex = 0
  let shifts = []

  // Create initial shifts
  for (const service of validServices) {
    let bestShift = null
    let bestStart = null
    let bestScore = -Infinity
    const serviceBorough = service.borough

    // Try all existing shifts in order of best fit
    const compatibleShifts = shifts
      .filter((s) => s.services[0].borough === serviceBorough && s.services.length < 14)
      .sort((a, b) => {
        // Sort shifts by closest time and location
        const aStart = Math.min(...a.services.map((s) => new Date(s.start).getTime()))
        const bStart = Math.min(...b.services.map((s) => new Date(s.start).getTime()))
        const serviceStart = new Date(service.time.range[0]).getTime()

        // Calculate average distance to services in each shift
        const aAvgDist =
          a.services.reduce(
            (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
            0,
          ) / a.services.length
        const bAvgDist =
          b.services.reduce(
            (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
            0,
          ) / b.services.length

        // Score based on time proximity and average distance
        const aScore = Math.abs(aStart - serviceStart) / 3600000 + aAvgDist
        const bScore = Math.abs(bStart - serviceStart) / 3600000 + bAvgDist
        return aScore - bScore
      })

    // Try each compatible shift
    for (const shift of compatibleShifts) {
      const shiftStartTime = Math.min(...shift.services.map((s) => new Date(s.start).getTime()))
      const shiftEndTime = Math.max(...shift.services.map((s) => new Date(s.end).getTime()))

      // Try each existing service as a potential connection point
      for (const existingService of shift.services) {
        // Skip if too far or different borough
        const distance = distanceMatrix[existingService.originalIndex][service.originalIndex]
        if (distance > MAX_DISTANCE) continue

        // Try to schedule after this service
        const tryStart = new Date(
          Math.max(
            new Date(service.time.range[0]).getTime(),
            new Date(existingService.end).getTime() + 15 * 60000,
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

    // Add to best existing shift or create new one
    if (bestShift && bestStart) {
      bestShift.services.push({
        ...service,
        cluster: bestShift.cluster,
        start: bestStart.toISOString(),
        end: new Date(bestStart.getTime() + service.time.duration * 60000).toISOString(),
      })
    } else {
      shifts.push(createNewShift(service, clusterIndex++))
    }
  }

  return shifts
}

function calculateShiftScore(shift, service, startTime, distanceMatrix) {
  const avgDistance = calculateAverageDistance(shift, service, distanceMatrix)

  // Calculate time window overlap bonus
  const overlapBonus = shift.services.reduce((bonus, s) => {
    const overlap = getTimeWindowOverlap(service, s)
    return bonus + overlap / 30 // Convert to score
  }, 0)

  // Scoring components
  const distanceScore = -Math.pow(avgDistance, 1.1)
  const sizeBonus = shift.services.length < MIN_SERVICES_PER_SHIFT ? 400 : 200
  const smallShiftBonus = shift.services.length === 1 ? 150 : 0

  return distanceScore + overlapBonus + sizeBonus + smallShiftBonus
}

function calculateAverageDistance(shift, service, distanceMatrix) {
  return (
    shift.services.reduce(
      (sum, s) => sum + distanceMatrix[s.originalIndex][service.originalIndex],
      0,
    ) / shift.services.length
  )
}

function optimizeClusters(shifts, distanceMatrix) {
  let madeChanges = true
  let iterations = 0
  const MAX_ITERATIONS = 3

  while (madeChanges && iterations < MAX_ITERATIONS) {
    madeChanges = false
    iterations++

    // First pass: Try to merge entire shifts
    for (let i = 0; i < shifts.length; i++) {
      const sourceShift = shifts[i]
      if (!sourceShift?.services?.length) continue

      for (let j = i + 1; j < shifts.length; j++) {
        const targetShift = shifts[j]
        if (!targetShift?.services?.length) continue

        // Check borough and capacity constraints
        if (sourceShift.services[0].borough !== targetShift.services[0].borough) continue
        if (sourceShift.services.length + targetShift.services.length > 14) continue

        // Try to merge shifts
        const allServices = [...sourceShift.services, ...targetShift.services]

        // Get valid start/end times
        const validTimes = allServices
          .map((s) => ({
            start: new Date(s.start),
            end: new Date(s.end),
          }))
          .filter((t) => !isNaN(t.start.getTime()) && !isNaN(t.end.getTime()))

        if (!validTimes.length) continue

        const shiftStart = Math.min(...validTimes.map((t) => t.start.getTime()))
        const shiftEnd = Math.max(...validTimes.map((t) => t.end.getTime()))

        // Check duration constraint
        if ((shiftEnd - shiftStart) / (60 * 1000) > SHIFT_DURATION) continue

        // Check all distances
        let canMerge = true
        for (const s1 of sourceShift.services) {
          for (const s2 of targetShift.services) {
            const distance = distanceMatrix[s1.originalIndex][s2.originalIndex]
            if (distance > MAX_DISTANCE) {
              canMerge = false
              break
            }
          }
          if (!canMerge) break
        }

        if (canMerge) {
          // Merge the shifts
          sourceShift.services.push(...targetShift.services)
          sourceShift.endTime = new Date(shiftEnd)
          shifts[j] = null
          madeChanges = true
        }
      }
    }

    // Clean up null shifts
    shifts = shifts.filter(Boolean)

    // Second pass: Try to move individual services
    for (let i = 0; i < shifts.length; i++) {
      const sourceShift = shifts[i]
      if (!sourceShift?.services?.length || sourceShift.services.length <= 1) continue

      for (const service of [...sourceShift.services]) {
        for (let j = 0; j < shifts.length; j++) {
          if (i === j) continue
          const targetShift = shifts[j]
          if (!targetShift?.services?.length) continue

          // Check constraints
          if (service.borough !== targetShift.services[0].borough) continue
          if (targetShift.services.length >= 14) continue

          // Try to find a time slot
          const startTime = findBestTimeSlot(targetShift, service, distanceMatrix)
          if (startTime && !isNaN(startTime.getTime())) {
            // Move service to new shift
            sourceShift.services = sourceShift.services.filter((s) => s !== service)
            targetShift.services.push({
              ...service,
              cluster: targetShift.cluster,
              start: startTime.toISOString(),
              end: new Date(startTime.getTime() + service.time.duration * 60000).toISOString(),
            })
            madeChanges = true
            break
          }
        }
      }
    }

    // Remove empty shifts
    shifts = shifts.filter((shift) => shift?.services?.length > 0)
  }

  // Final pass: Renumber clusters
  shifts.forEach((shift, index) => {
    shift.cluster = index
    shift.services.forEach((service) => {
      service.cluster = index
    })
  })

  return shifts
}

parentPort.on('message', async ({ services, distanceMatrix }) => {
  const startTime = performance.now()

  try {
    console.log('\nStarting clustering with services:', services.length)

    // Filter out any invalid services first
    const validServices = services.filter((service) => {
      const isValid =
        service &&
        service.location?.latitude != null &&
        service.location?.longitude != null &&
        service.time?.range?.[0] &&
        service.time?.range?.[1]

      if (!isValid) {
        console.log('Invalid service:', {
          company: service?.company,
          location: service?.location,
          timeRange: service?.time?.range,
        })
      }

      return isValid
    })

    console.log('Valid services after filtering:', validServices.length)
    logBoroughStats(validServices)

    if (validServices.length === 0) {
      throw new Error('No valid services to cluster')
    }

    let shifts = createShifts(validServices, distanceMatrix)

    // Optimize clusters
    shifts = optimizeClusters(shifts, distanceMatrix)

    const clusteredServices = shifts.flatMap((shift) => shift.services)
    const endTime = performance.now()

    parentPort.postMessage({
      clusteredServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Math.round(endTime - startTime),
        connectedPointsCount: validServices.length,
        outlierCount: services.length - validServices.length,
        totalClusters: shifts.length,
        clusterSizes: shifts.map((shift) => shift.services.length),
      },
    })
  } catch (error) {
    console.error('Error in clustering worker:', error)
    // Return original services marked as outliers
    parentPort.postMessage({
      clusteredServices: services
        .map((service) =>
          service
            ? {
                ...service,
                cluster: -1,
              }
            : null,
        )
        .filter(Boolean),
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: 0,
        connectedPointsCount: 0,
        outlierCount: services.length,
        totalClusters: 0,
        clusterSizes: [],
      },
    })
  }
})

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
