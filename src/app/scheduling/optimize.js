// /src/app/scheduling/optimize.js
import {
  addMinutes,
  max as getMax,
  min as getMin,
} from '../utils/dateHelpers.js'
import { createDistanceMatrix } from '../utils/distance.js'
import { MAX_SHIFT_HOURS } from './index.js'

/**
 * Recalculates the optimal indices for services within a shift based on chronological order and proximity.
 * This function schedules services in chronological order, selecting the closest feasible service next.
 * It also identifies gaps and attempts to insert far-away services into those gaps.
 * @param {Object} shift - The shift containing scheduled services.
 */
export async function recalculateOptimalIndices(shift) {
  const services = [...shift.services] // Clone to avoid mutating the original array
  const distanceMatrix = await createDistanceMatrix(services)

  if (services.length === 0) return

  // Sort services by earliest start time using direct date comparisons
  services.sort((a, b) => new Date(a.start) - new Date(b.start))

  const scheduled = []
  const unscheduled = new Set(services.map(service => service.id)) // Assuming each service has a unique 'id'

  // Initial scheduling: schedule services chronologically
  while (unscheduled.size > 0) {
    // Find the next service to schedule: the earliest starting unscheduled service
    let nextService = null
    let earliestStart = null

    for (const service of services) {
      if (!unscheduled.has(service.id)) continue

      const serviceStart = new Date(service.start)

      if (earliestStart === null || serviceStart < earliestStart) {
        earliestStart = serviceStart
        nextService = service
      }
    }

    if (!nextService) break // No feasible service found

    // Schedule the nextService
    scheduled.push(nextService)
    unscheduled.delete(nextService.id)

    // Update the end time based on the service's end time
    let lastScheduledEnd = new Date(nextService.end)

    // Find the closest feasible service that starts after the current one ends
    let closestService = null
    let minDistance = Infinity

    for (const service of services) {
      if (!unscheduled.has(service.id)) continue

      const serviceStart = new Date(service.start)

      // Check if the service can start after the last scheduled service ends
      if (serviceStart >= lastScheduledEnd) {
        // Find distance from the last scheduled service to this service
        const fromIndex = services.findIndex(s => s.id === nextService.id)
        const toIndex = services.findIndex(s => s.id === service.id)
        const distance = distanceMatrix[fromIndex][toIndex]

        if (distance !== null && distance < minDistance) {
          minDistance = distance
          closestService = service
        }
      }
    }

    if (closestService) {
      // Schedule the closestService
      scheduled.push(closestService)
      unscheduled.delete(closestService.id)
      lastScheduledEnd = new Date(closestService.end)
    }
  }

  // Assign indices based on the scheduled order
  scheduled.forEach((service, idx) => {
    service.index = idx
  })

  // Assign remaining unscheduled services at the end, sorted by their earliest start time
  const remainingServices = services
    .filter(service => unscheduled.has(service.id))
    .sort((a, b) => new Date(a.start) - new Date(b.start))

  remainingServices.forEach((service, idx) => {
    service.index = scheduled.length + idx
    scheduled.push(service)
  })

  // Update the shift's services with the new order and assigned indices
  shift.services = scheduled

  // Identify gaps in the schedule
  const gaps = identifyGaps(
    shift.services,
    new Date(shift.shiftStart),
    new Date(shift.shiftEnd),
  )

  // Attempt to insert unscheduled services into gaps based on proximity
  for (const gap of gaps) {
    for (const service of remainingServices) {
      if (canFitInGap(service, gap)) {
        // Insert the service into the gap
        shift.services.splice(gap.position, 0, service)
        service.index = gap.position
        // Update indices of subsequent services
        for (let i = gap.position + 1; i < shift.services.length; i++) {
          shift.services[i].index = i
        }
        // Update distances
        await updateDistances(shift.services)
        // Remove the service from remainingServices
        remainingServices.splice(remainingServices.indexOf(service), 1)
        break // Move to the next gap after inserting a service
      }
    }
  }

  // Reassign indices after inserting into gaps
  shift.services.forEach((service, idx) => {
    service.index = idx
  })

  // Update distances after inserting into gaps
  await updateDistances(shift.services)
}

/**
 * Identifies gaps within the scheduled services.
 * @param {Array} services - Array of scheduled services.
 * @param {Date} shiftStart - Start time of the shift.
 * @param {Date} shiftEnd - End time of the shift.
 * @returns {Array} - Array of gap objects with start, end, and position.
 */
function identifyGaps(services, shiftStart, shiftEnd) {
  const gaps = []
  let previousEnd = shiftStart

  services.forEach((service, index) => {
    const serviceStart = new Date(service.start)
    if (serviceStart > previousEnd) {
      gaps.push({
        start: previousEnd,
        end: new Date(service.start),
        position: index,
      })
    }
    const serviceEnd = new Date(service.end)
    if (serviceEnd > previousEnd) {
      previousEnd = serviceEnd
    }
  })

  if (previousEnd < shiftEnd) {
    gaps.push({
      start: previousEnd,
      end: shiftEnd,
      position: services.length,
    })
  }

  return gaps
}

/**
 * Determines if a service can fit within a given gap based on its time range.
 * @param {Object} service - The service to be scheduled.
 * @param {Object} gap - The gap object containing start, end, and position.
 * @returns {Boolean} - True if the service can fit in the gap, false otherwise.
 */
function canFitInGap(service, gap) {
  const serviceStart = new Date(service.start)
  const serviceEnd = new Date(service.end)
  const gapStart = gap.start
  const gapEnd = gap.end

  return serviceStart >= gapStart && serviceEnd <= gapEnd
}

/**
 * Updates the distance information for each service within a shift.
 * @param {Object} shift - The shift containing scheduled services.
 */
export async function updateDistances(services) {
  const distanceMatrix = await createDistanceMatrix(services)

  for (let i = 1; i < services.length; i++) {
    const previousService = services[i - 1]
    const currentService = services[i]
    currentService.distanceFromPrevious = distanceMatrix[i - 1][i]
    currentService.previousCompany = previousService.company
  }
}

export async function findBestPosition(shift, newService) {
  const extendedShift = {
    ...shift,
    services: [...shift.services, newService],
  }
  const distanceMatrix = await createDistanceMatrix(extendedShift.services)

  let bestPosition = 0
  let minTotalDistance = Infinity

  for (let i = 0; i <= shift.services.length; i++) {
    if (isPositionFeasible(shift, newService, i)) {
      const totalDistance = calculateTotalDistanceForInsertion(
        distanceMatrix,
        i,
        shift.services.length,
      )

      if (totalDistance < minTotalDistance) {
        minTotalDistance = totalDistance
        bestPosition = i
      }
    }
  }

  // Update indices of existing services
  for (let i = bestPosition; i < shift.services.length; i++) {
    shift.services[i].index++
  }

  return bestPosition
}
