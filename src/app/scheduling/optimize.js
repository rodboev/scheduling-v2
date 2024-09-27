import { addMinutes, max, min } from '../utils/dateHelpers.js'
import {
  calculateDistancesForShift,
  calculateTravelDistance,
} from './distance.js'

export async function findBestPosition(shift, newService) {
  const extendedShift = {
    ...shift,
    services: [...shift.services, newService],
  }
  const distanceMatrix = await calculateDistancesForShift(extendedShift)

  let bestPosition = 0
  let minTotalDistance = Infinity

  for (let i = 0; i <= shift.services.length; i++) {
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
