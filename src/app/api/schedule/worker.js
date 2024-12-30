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

      // Check borough boundaries
      if (
        !areSameBorough(
          scheduled.location.latitude,
          scheduled.location.longitude,
          service.location.latitude,
          service.location.longitude,
        ) &&
        scheduledDistance > MAX_RADIUS_MILES_ACROSS_BOROUGHS
      ) {
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
        const locationBonus = areSameBorough(
          currentService.location.latitude,
          currentService.location.longitude,
          service.location.latitude,
          service.location.longitude,
        )
          ? 2
          : 0

        const score =
          distanceScore + timeGapScore + durationBonus + flexibilityPenalty + locationBonus

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

  if (bestService && bestStart) {
    return {
      ...bestService,
      start: bestStart.toISOString(),
      end: new Date(bestStart.getTime() + bestService.time.duration * 60000).toISOString(),
      distanceFromPrevious: distanceMatrix[currentIndex][bestService.originalIndex],
      previousCompany: currentService.company,
      travelTimeFromPrevious: calculateTravelTime(
        distanceMatrix,
        currentIndex,
        bestService.originalIndex,
      ),
    }
  }

  return null
}

async function processServices(services, distanceMatrix) {
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
      .sort((a, b) => {
        // First group by rough time periods (morning/afternoon)
        const aPeriod = Math.floor(a.startTime.getHours() / 4)
        const bPeriod = Math.floor(b.startTime.getHours() / 4)
        if (aPeriod !== bPeriod) return aPeriod - bPeriod

        // Then by time window flexibility
        return a.timeWindow - b.timeWindow
      })

    // Group services by tech and date
    const techDayGroups = {}
    for (const service of sortedServices) {
      // Ensure we have valid dates
      const startTime = new Date(service.time.range[0])
      if (isNaN(startTime.getTime())) {
        console.error('Invalid start time for service:', service.id)
        continue
      }

      const date = startTime.toISOString().split('T')[0]
      const techId = service.tech.code
      const shift = getShiftForTime(startTime)
      const key = `${techId}_${date}_${shift}`

      if (!techDayGroups[key]) {
        techDayGroups[key] = []
      }
      techDayGroups[key].push(service)
    }

    // Process each tech-day group
    const processedServices = []
    let clusterNum = 0

    for (const [key, groupServices] of Object.entries(techDayGroups)) {
      // Sort services by start time within each group
      groupServices.sort((a, b) => new Date(a.time.range[0]) - new Date(b.time.range[0]))

      // Process each service in the group
      const scheduledServices = []
      const unscheduledServices = []

      // Start with the first service
      if (groupServices.length > 0) {
        const firstService = groupServices[0]
        const shiftStart = new Date(firstService.time.range[0])
        scheduledServices.push({
          ...firstService,
          cluster: clusterNum,
          sequenceNumber: 1,
          start: shiftStart.toISOString(),
          end: new Date(shiftStart.getTime() + firstService.time.duration * 60000).toISOString(),
        })

        // Process remaining services
        for (let i = 1; i < groupServices.length; i++) {
          const currentService = groupServices[i]
          const lastScheduled = scheduledServices[scheduledServices.length - 1]

          const nextService = findBestNextService(
            lastScheduled,
            [currentService],
            distanceMatrix,
            new Date(lastScheduled.end),
            scheduledServices,
          )

          if (nextService) {
            scheduledServices.push({
              ...nextService,
              cluster: clusterNum,
              sequenceNumber: scheduledServices.length + 1,
            })
          } else {
            unscheduledServices.push(currentService)
          }
        }

        processedServices.push(...scheduledServices)
        clusterNum++
      }
    }

    const endTime = performance.now()
    const duration = endTime - startTime

    // Calculate clustering info
    const clusters = new Set(processedServices.map(s => s.cluster).filter(c => c >= 0))
    const clusterSizes = Array.from(clusters).map(
      c => processedServices.filter(s => s.cluster === c).length,
    )

    return {
      scheduledServices: processedServices,
      unassignedServices: [],
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(duration),
        connectedPointsCount: processedServices.length,
        outlierCount: services.length - processedServices.length,
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

function getShiftForTime(time) {
  const hour = new Date(time).getUTCHours()
  if (hour >= 8 && hour < 16) return 1
  if (hour >= 16) return 2
  return 3
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
        outlierCount: services.length,
        totalClusters: 0,
        clusterSizes: [],
        clusterDistribution: [],
      },
    })
  }
})
