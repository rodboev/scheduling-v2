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

function roundToNearestInterval(date) {
  const minutes = date.getMinutes()
  const roundedMinutes = Math.ceil(minutes / TIME_INCREMENT) * TIME_INCREMENT
  const newDate = new Date(date)
  newDate.setMinutes(roundedMinutes)
  return newDate
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

function getTimeWindowOverlapScore(service, existingServices) {
  let totalOverlap = 0
  const serviceStart = new Date(service.time.range[0])
  const serviceEnd = new Date(service.time.range[1])

  for (const existing of existingServices) {
    const existingStart = new Date(existing.time.range[0])
    const existingEnd = new Date(existing.time.range[1])

    const overlapStart = Math.max(serviceStart, existingStart)
    const overlapEnd = Math.min(serviceEnd, existingEnd)
    const overlapDuration = Math.max(0, (overlapEnd - overlapStart) / (60 * 1000))
    totalOverlap += overlapDuration
  }

  return totalOverlap / existingServices.length
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
  let bestStart = null
  let bestScore = -Infinity

  const currentEnd = new Date(currentService.end)
  const currentLocation = {
    lat: currentService.location.latitude,
    lng: currentService.location.longitude,
  }

  for (const service of remainingServices) {
    // Skip if already scheduled
    if (scheduledServices.some(s => s.id === service.id)) continue

    // Check distance constraints
    const distance = distanceMatrix[currentService.originalIndex][service.originalIndex]
    if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

    // Check borough boundaries
    if (
      !areSameBorough(
        currentService.location.latitude,
        currentService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      ) &&
      distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS
    ) {
      continue
    }

    // Calculate minimum travel time based on distance
    const travelTime = Math.max(15, Math.ceil(distance * 2.5)) // At least 15 minutes, or 2.5 minutes per mile

    // Calculate earliest possible start time after current service
    let tryStart = new Date(currentEnd.getTime() + travelTime * 60000)
    const serviceStart = new Date(service.time.range[0])
    const serviceEnd = new Date(service.time.range[1])
    const serviceDuration = service.time.duration * 60000

    // Try different start times within the service's time window
    while (tryStart <= serviceEnd) {
      const tryEnd = new Date(tryStart.getTime() + serviceDuration)

      // Check if this time slot works
      if (tryStart >= serviceStart && tryEnd <= serviceEnd && (!shiftEnd || tryEnd <= shiftEnd)) {
        // Calculate score based on multiple factors
        const timeGap = (tryStart - currentEnd) / 60000 // Gap in minutes
        const timeFlexibility = (serviceEnd - serviceStart) / 60000 // Window size in minutes
        const preferredTime = new Date(service.time.preferred)
        const preferredDiff = Math.abs(tryStart - preferredTime) / 60000 // Minutes from preferred time

        // Score components:
        // 1. Minimize time gap (but not too small)
        const gapScore = timeGap < 15 ? -100 : -Math.log(timeGap)
        // 2. Prefer services with less flexibility (harder to schedule)
        const flexScore = -Math.log(timeFlexibility)
        // 3. Minimize distance
        const distanceScore = -Math.log(distance + 1)
        // 4. Prefer times closer to preferred time
        const preferredScore = -Math.log(preferredDiff + 1)

        const score = gapScore + flexScore + distanceScore + preferredScore

        if (score > bestScore) {
          bestScore = score
          bestService = service
          bestStart = tryStart
        }
      }

      // Try next time slot (15-minute increments)
      tryStart = new Date(tryStart.getTime() + 15 * 60000)
    }
  }

  return bestService ? { service: bestService, start: bestStart } : null
}

function processServices(services, distanceMatrix) {
  try {
    const startTime = performance.now()

    // Sort services by time window and start time, prioritizing overlapping windows
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
      const date = service.startTime.toISOString().split('T')[0]
      const techId = service.tech.code
      const key = `${techId}_${date}`

      if (!techDayGroups[key]) {
        techDayGroups[key] = []
      }
      techDayGroups[key].push(service)
    }

    // Process each tech-day group
    const processedServices = []
    let clusterNum = 0

    for (const [key, groupServices] of Object.entries(techDayGroups)) {
      const shifts = []

      // First pass: Create initial shifts with anchor services
      let remainingServices = [...groupServices]
      while (remainingServices.length > 0) {
        const service = remainingServices[0]
        let bestShift = null
        let bestStart = null

        // Try to add to existing shifts first
        for (const shift of shifts) {
          const lastService = shift.services[shift.services.length - 1]
          const nextService = findBestNextService(
            lastService,
            [service],
            distanceMatrix,
            null,
            shift.services,
          )

          if (nextService) {
            bestShift = shift
            bestStart = nextService.start
            break
          }
        }

        // If no existing shift works, create a new one
        if (!bestShift) {
          const newShift = {
            services: [
              {
                ...service,
                cluster: clusterNum,
                sequenceNumber: 1,
                start: formatDate(service.startTime),
                end: formatDate(
                  new Date(service.startTime.getTime() + service.time.duration * 60000),
                ),
                distanceFromPrevious: 0,
                travelTimeFromPrevious: 0, // No travel time for first service
                previousService: null,
                previousCompany: null, // No previous company for first service
              },
            ],
            cluster: clusterNum,
          }
          shifts.push(newShift)
          clusterNum++
        } else {
          const previousService = bestShift.services[bestShift.services.length - 1]
          const distance = distanceMatrix[previousService.originalIndex][service.originalIndex]

          const serviceToAdd = {
            ...service,
            cluster: bestShift.cluster,
            sequenceNumber: bestShift.services.length + 1,
            start: formatDate(bestStart),
            end: formatDate(new Date(bestStart.getTime() + service.time.duration * 60000)),
            distanceFromPrevious: distance || 0,
            travelTimeFromPrevious: distance ? calculateTravelTime(distance) : 15,
            previousService: previousService.id,
            previousCompany: previousService.company,
          }

          bestShift.services.push(serviceToAdd)
        }

        remainingServices = remainingServices.slice(1)
      }

      // Second pass: Try to merge compatible shifts
      let mergedShifts = true
      while (mergedShifts) {
        mergedShifts = false
        for (let i = 0; i < shifts.length; i++) {
          const shift = shifts[i]
          for (let j = i + 1; j < shifts.length; j++) {
            const otherShift = shifts[j]

            // Check if shifts can be merged
            const firstServiceOther = otherShift.services[0]
            const lastServiceCurrent = shift.services[shift.services.length - 1]

            const nextService = findBestNextService(
              lastServiceCurrent,
              [firstServiceOther],
              distanceMatrix,
              null,
              shift.services,
            )

            if (nextService) {
              // Merge shifts
              const mergedServices = [...shift.services]
              for (const service of otherShift.services) {
                const previousService = mergedServices[mergedServices.length - 1]
                const distance =
                  distanceMatrix[previousService.originalIndex][service.originalIndex]

                mergedServices.push({
                  ...service,
                  cluster: shift.cluster,
                  sequenceNumber: mergedServices.length + 1,
                  start:
                    service === firstServiceOther ? formatDate(nextService.start) : service.start,
                  end:
                    service === firstServiceOther
                      ? formatDate(
                          new Date(nextService.start.getTime() + service.time.duration * 60000),
                        )
                      : service.end,
                  distanceFromPrevious: distance || 0,
                  travelTimeFromPrevious: distance ? calculateTravelTime(distance) : 15,
                  previousService: previousService.id,
                  previousCompany: previousService.company,
                })
              }

              shift.services = mergedServices
              shifts.splice(j, 1)
              mergedShifts = true
              break
            }
          }
          if (mergedShifts) break
        }
      }

      // Add all scheduled services
      for (const shift of shifts) {
        processedServices.push(...shift.services)
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

  return {
    ...service,
    cluster: shift.cluster,
    start: shift.startTime.toISOString(),
    end: new Date(shift.startTime.getTime() + service.time.duration * 60000).toISOString(),
    previousService: previousService.id,
    previousCompany: previousService.company,
    distanceFromPrevious: distance,
    travelTimeFromPrevious: distance ? calculateTravelTime(distance) : 15,
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

    mergedServices.push({
      ...service,
      previousService: previousService.id,
      previousCompany: previousService.company,
      distanceFromPrevious: distance,
      travelTimeFromPrevious: distance ? calculateTravelTime(distance) : 15,
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
