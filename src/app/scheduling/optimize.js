// /src/app/scheduling/optimize.js
import { addMinutes, max, min } from '../utils/dateHelpers.js'
import {
  calculateDistancesForShift,
  calculateTravelDistance,
} from './distance.js'
import { MAX_SHIFT_HOURS } from './index.js'

/**
 * Finds the best position to insert a new service into a shift to minimize total travel distance.
 * @param {Object} shift - The current shift containing scheduled services.
 * @param {Object} newService - The service to be inserted.
 * @returns {Number} - The best position index to insert the new service.
 */
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

  return bestPosition
}

/**
 * Calculates the total travel distance for a given insertion position.
 * @param {Array} distanceMatrix - Matrix containing distances between services.
 * @param {Number} insertPosition - The index where the new service is to be inserted.
 * @param {Number} originalLength - The original number of services before insertion.
 * @returns {Number} - The total travel distance after insertion.
 */
function calculateTotalDistanceForInsertion(
  distanceMatrix,
  insertPosition,
  originalLength,
) {
  let totalDistance = 0
  for (let i = 0; i < originalLength + 1; i++) {
    if (i > 0) {
      const fromIndex = i <= insertPosition ? i - 1 : i
      const toIndex =
        i < insertPosition ? i : i === insertPosition ? originalLength : i - 1
      totalDistance += distanceMatrix[fromIndex][toIndex] || 0
    }
  }
  return totalDistance
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
 * Compacts the shift by adjusting service start and end times to eliminate gaps.
 * @param {Object} shift - The shift containing scheduled services.
 */
export function compactShift(shift) {
  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  for (let i = 0; i < shift.services.length - 1; i++) {
    const currentService = shift.services[i]
    const nextService = shift.services[i + 1]

    const currentEnd = new Date(currentService.end)
    const nextStart = new Date(nextService.start)
    const earliestPossibleStart = new Date(currentService.time.range[0])

    if (nextStart > currentEnd) {
      const latestPossibleStart = min(
        addMinutes(nextStart, -currentService.time.duration),
        addMinutes(
          new Date(currentService.time.range[1]),
          -currentService.time.duration,
        ),
      )

      if (latestPossibleStart > earliestPossibleStart) {
        const newStart = max(earliestPossibleStart, latestPossibleStart)
        const newEnd = addMinutes(newStart, currentService.time.duration)
        currentService.start = newStart
        currentService.end = newEnd
      }
    }
  }

  for (let i = shift.services.length - 1; i > 0; i--) {
    const currentService = shift.services[i]
    const previousService = shift.services[i - 1]

    const currentStart = new Date(currentService.start)
    const previousEnd = new Date(previousService.end)
    const latestPossibleEnd = new Date(currentService.time.range[1])

    if (currentStart > previousEnd) {
      const earliestPossibleStart = max(
        previousEnd,
        new Date(currentService.time.range[0]),
      )

      if (earliestPossibleStart < currentStart) {
        const newStart = earliestPossibleStart
        const newEnd = min(
          addMinutes(newStart, currentService.time.duration),
          latestPossibleEnd,
        )
        currentService.start = newStart
        currentService.end = newEnd
      }
    }
  }
}

/**
 * Recalculates the optimal indices for services within a shift based on proximity.
 * This function reorders services to minimize total travel distance and assigns indices.
 * @param {Object} shift - The shift containing scheduled services.
 */
export async function recalculateOptimalIndices(shift) {
  const services = shift.services
  const distanceMatrix = await calculateDistancesForShift(shift)

  // Use the greedy nearest neighbor algorithm for route optimization
  const route = await findOptimalRoute(services, distanceMatrix)

  // Reorder services based on the optimized route
  shift.services = route

  // Assign indices after reordering
  shift.services.forEach((service, idx) => {
    service.index = idx
  })

  // Update distances
  await updateShiftDistances(shift)
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
