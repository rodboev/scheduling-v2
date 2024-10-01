// /src/app/scheduling/optimize.js
import { addMinutes, max, min } from '../utils/dateHelpers.js'
import { calculateDistancesForShift } from './distance.js'
import { MAX_SHIFT_HOURS } from './index.js'

/**
 * Recalculates the optimal indices for services within a shift based on chronological order and proximity.
 * This function schedules services in chronological order, selecting the closest feasible service next.
 * @param {Object} shift - The shift containing scheduled services.
 */
export async function recalculateOptimalIndices(shift) {
  const services = [...shift.services] // Clone to avoid mutating the original array
  const distanceMatrix = await calculateDistancesForShift(shift)

  if (services.length === 0) return

  // Sort services by start time
  services.sort((a, b) => new Date(a.start) - new Date(b.start))

  // Assign indices based on the sorted order
  services.forEach((service, idx) => {
    service.index = idx
  })

  // Update the shift's services with the new order and assigned indices
  shift.services = services

  // Update distances between consecutive services
  await updateShiftDistances(shift)
}

/**
 * Updates the distance information for each service within a shift.
 * @param {Object} shift - The shift containing scheduled services.
 */
export async function updateShiftDistances(shift) {
  const distanceMatrix = await calculateDistancesForShift(shift)

  for (let i = 1; i < shift.services.length; i++) {
    const previousService = shift.services[i - 1]
    const currentService = shift.services[i]
    currentService.distanceFromPrevious = distanceMatrix[i - 1][i]
    currentService.previousCompany = previousService.company
  }
}

/**
 * Finds the optimal route for a set of services using the nearest neighbor heuristic.
 * @param {Array} services - Array of services to be scheduled.
 * @param {Array} distanceMatrix - Matrix containing distances between services.
 * @returns {Array} - Ordered array of services representing the optimized route.
 */
export async function findOptimalRoute(services, distanceMatrix) {
  if (services.length === 0) return []

  const route = []
  const visited = new Set()

  // Start with the first service
  let currentIndex = 0
  route.push(services[currentIndex])
  visited.add(currentIndex)

  while (route.length < services.length) {
    let nearestIndex = -1
    let minDistance = Infinity

    for (let i = 0; i < services.length; i++) {
      if (!visited.has(i)) {
        const distance = distanceMatrix[currentIndex][i]
        if (distance !== null && distance < minDistance) {
          minDistance = distance
          nearestIndex = i
        }
      }
    }

    if (nearestIndex === -1) break // No reachable unvisited nodes

    route.push(services[nearestIndex])
    visited.add(nearestIndex)
    currentIndex = nearestIndex
  }

  return route
}

/**
 * Determines if inserting a service at a specific position within a shift is feasible.
 * @param {Object} shift - The current shift containing scheduled services.
 * @param {Object} newService - The service to be inserted.
 * @param {Number} position - The index at which to insert the new service.
 * @returns {Boolean} - True if the position is feasible, false otherwise.
 */
function isPositionFeasible(shift, newService, position) {
  const newStart = new Date(newService.start)
  const newEnd = new Date(newService.end)

  if (position === 0) {
    return (
      shift.services.length === 0 || newEnd <= new Date(shift.services[0].start)
    )
  }

  if (position === shift.services.length) {
    return newStart >= new Date(shift.services[shift.services.length - 1].end)
  }

  const prevEnd = new Date(shift.services[position - 1].end)
  const nextStart = new Date(shift.services[position].start)

  return newStart >= prevEnd && newEnd <= nextStart
}

export async function findBestPosition(shift, newService) {
  const extendedShift = {
    ...shift,
    services: [...shift.services, newService],
  }
  const distanceMatrix = await calculateDistancesForShift(extendedShift)

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
