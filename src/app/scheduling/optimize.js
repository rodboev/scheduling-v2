import { addMinutes, max, min } from '../utils/dateHelpers.js'
import { calculateDistancesForShift } from './distance.js'
import { MAX_SHIFT_HOURS } from './index.js'

export async function optimizeShift(shift) {
  const distanceMatrix = await calculateDistancesForShift(shift)
  const n = shift.services.length

  let bestOrder = findBestOrder(shift, distanceMatrix)

  // Reorder the services based on the best order
  shift.services = bestOrder.map(i => shift.services[i])

  // Update start and end times
  let currentTime = new Date(shift.shiftStart)
  const shiftEnd = new Date(shift.shiftStart)
  shiftEnd.setHours(shiftEnd.getHours() + MAX_SHIFT_HOURS)

  for (let service of shift.services) {
    const [rangeStart, rangeEnd] = service.time.range.map(
      date => new Date(date),
    )
    service.start = max(currentTime, rangeStart)
    service.end = min(
      addMinutes(service.start, service.time.duration),
      rangeEnd,
      shiftEnd,
    )

    if (service.end <= service.start || service.start >= shiftEnd) {
      // If the service can't be scheduled within its time range or shift end, remove it
      console.warn(
        `Service ${service.id} couldn't be scheduled within its time range or shift end`,
      )
      shift.services = shift.services.filter(s => s.id !== service.id)
    } else {
      currentTime = service.end
    }
  }

  // Update distances
  await updateShiftDistances(shift)

  // Update shift end time
  shift.shiftEnd =
    shift.services.length > 0
      ? shift.services[shift.services.length - 1].end
      : shift.shiftStart
}

function findBestOrder(shift, distanceMatrix) {
  const n = shift.services.length
  let bestOrder = [...Array(n).keys()]
  let bestDistance = calculateTotalDistance(bestOrder, distanceMatrix)

  // Simple 2-opt algorithm for TSP
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        let newOrder = twoOptSwap(bestOrder, i, j)
        if (isValidOrder(newOrder, shift)) {
          let newDistance = calculateTotalDistance(newOrder, distanceMatrix)
          if (newDistance < bestDistance) {
            bestOrder = newOrder
            bestDistance = newDistance
            improved = true
          }
        }
      }
    }
  }

  return bestOrder
}

function twoOptSwap(route, i, j) {
  const newRoute = route.slice(0, i)
  newRoute.push(...route.slice(i, j + 1).reverse())
  newRoute.push(...route.slice(j + 1))
  return newRoute
}

function isValidOrder(order, shift) {
  let currentTime = new Date(shift.shiftStart)
  const shiftEnd = new Date(shift.shiftStart)
  shiftEnd.setHours(shiftEnd.getHours() + MAX_SHIFT_HOURS)

  for (let i of order) {
    const service = shift.services[i]
    const [rangeStart, rangeEnd] = service.time.range.map(
      date => new Date(date),
    )
    const potentialStart = max(currentTime, rangeStart)
    const potentialEnd = min(
      addMinutes(potentialStart, service.time.duration),
      rangeEnd,
      shiftEnd,
    )

    if (potentialEnd <= potentialStart || potentialStart >= shiftEnd)
      return false
    currentTime = potentialEnd
  }
  return true
}

function calculateTotalDistance(order, distanceMatrix) {
  let totalDistance = 0
  for (let i = 0; i < order.length - 1; i++) {
    totalDistance += distanceMatrix[order[i]][order[i + 1]] || 0
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
