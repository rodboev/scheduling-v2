import { addMinutes, max, min } from '../utils/dateHelpers.js'
import {
  calculateDistancesForShift,
  calculateTravelDistance,
} from './distance.js'
import { MAX_SHIFT_HOURS } from './index.js'

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

export async function updateShiftDistances(shift) {
  const distanceMatrix = await calculateDistancesForShift(shift)

  for (let i = 1; i < shift.services.length; i++) {
    const previousService = shift.services[i - 1]
    const currentService = shift.services[i]
    currentService.distanceFromPrevious = distanceMatrix[i - 1][i]
    currentService.previousCompany = previousService.company
  }
}

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

export function fillGaps(shift) {
  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  for (let i = 1; i < shift.services.length; i++) {
    const currentService = shift.services[i]
    const previousService = shift.services[i - 1]
    const currentStart = new Date(currentService.start)
    const previousEnd = new Date(previousService.end)

    if (currentStart > previousEnd) {
      const earliestPossibleStart = max(
        previousEnd,
        new Date(currentService.time.range[0]),
      )
      if (earliestPossibleStart < currentStart) {
        const newStart = earliestPossibleStart
        const newEnd = addMinutes(newStart, currentService.time.duration)
        currentService.start = newStart
        currentService.end = newEnd
      }
    }
  }
}

// In optimize.js, add this function:
export async function recalculateOptimalIndices(shift) {
  const services = shift.services
  const distanceMatrix = await calculateDistancesForShift({ services })

  // Sort services by start time
  services.sort((a, b) => new Date(a.start) - new Date(b.start))

  // Initialize the first service
  services[0].index = 0
  let lastIndex = 0

  // Iterate through the remaining services
  for (let i = 1; i < services.length; i++) {
    const currentService = services[i]
    const currentStart = new Date(currentService.start)

    // Find the closest unassigned service that starts after the previous service
    let closestIndex = -1
    let minDistance = Infinity

    for (let j = i; j < services.length; j++) {
      const candidateService = services[j]
      if (candidateService.index === undefined) {
        const candidateStart = new Date(candidateService.start)
        if (candidateStart >= currentStart) {
          const distance = distanceMatrix[lastIndex][j]
          if (distance < minDistance) {
            minDistance = distance
            closestIndex = j
          }
        }
      }
    }

    // Assign the index to the closest service
    if (closestIndex !== -1) {
      services[closestIndex].index = i
      lastIndex = closestIndex
    } else {
      // If no suitable service found, assign the current index
      currentService.index = i
      lastIndex = i
    }
  }

  // Sort the services array based on the new indices
  services.sort((a, b) => a.index - b.index)
}

export async function findOptimalRoute(services) {
  const distanceMatrix = await calculateDistancesForShift({ services })

  // Implement a TSP solver here. For simplicity, we'll use a greedy algorithm.
  // You might want to replace this with a more sophisticated TSP algorithm for better results.
  const route = [0] // Start with the first service
  const unvisited = new Set(services.map((_, i) => i).slice(1))

  while (unvisited.size > 0) {
    const current = route[route.length - 1]
    let nearest = null
    let minDistance = Infinity

    for (const next of unvisited) {
      const distance = distanceMatrix[current][next]
      if (distance !== null && distance < minDistance) {
        minDistance = distance
        nearest = next
      }
    }

    if (nearest === null) break // No reachable unvisited nodes

    route.push(nearest)
    unvisited.delete(nearest)
  }

  return route.map(index => services[index])
}

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
