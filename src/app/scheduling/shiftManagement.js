import {
  MIN_REST_HOURS,
  MAX_SHIFT_GAP,
  MAX_SHIFT_HOURS,
} from '@/app/scheduling'
import { addHours, addMinutes, max, min } from '@/app/utils/dateHelpers'

export function compactShift(shift) {
  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  // First pass: Move services forward
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

  // Second pass: Move services backward
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

export function flattenServices(techSchedules) {
  // Convert techSchedules to flat scheduledServices array with start and end dates
  return Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.shifts.flatMap(shift =>
      shift.services.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: techId,
      })),
    ),
  )
}

export function createNewShift({
  techSchedule,
  rangeStart,
  remainingServices,
}) {
  const lastShift = techSchedule.shifts[techSchedule.shifts.length - 1]
  let newShiftStart = new Date(rangeStart)
  if (lastShift) {
    const minStartTime = addHours(new Date(lastShift.shiftEnd), MIN_REST_HOURS)
    newShiftStart = max(newShiftStart, minStartTime)
  }

  return {
    shiftStart: newShiftStart,
    shiftEnd: addHours(newShiftStart, MAX_SHIFT_HOURS),
    services: [],
  }
}

export function createNewShiftWithConsistentStartTime({
  techSchedule,
  rangeStart,
  remainingServices,
}) {
  const lastShift = techSchedule.shifts[techSchedule.shifts.length - 1]
  let newShiftStart = new Date(rangeStart)

  if (lastShift) {
    const lastShiftEnd = new Date(lastShift.shiftEnd)
    const minStartTime = addHours(lastShiftEnd, MIN_REST_HOURS)

    // If the range start is before the minimum start time, use the minimum start time
    if (newShiftStart < minStartTime) {
      newShiftStart = minStartTime
    }

    // If the new shift would start more than MAX_SHIFT_GAP hours after the last shift,
    // try to find a service that starts earlier
    if ((newShiftStart - lastShiftEnd) / (1000 * 60 * 60) > MAX_SHIFT_GAP) {
      const earlierService = remainingServices.find(
        s =>
          new Date(s.time.range[0]) < newShiftStart &&
          new Date(s.time.range[0]) > minStartTime,
      )
      if (earlierService) {
        newShiftStart = new Date(earlierService.time.range[0])
      }
    }
  }

  return {
    shiftStart: newShiftStart,
    shiftEnd: addHours(newShiftStart, MAX_SHIFT_HOURS),
    services: [],
  }
}

function getNextPreferredStartTime(fromTime, lastShiftStart) {
  const preferredTime = new Date(lastShiftStart)
  preferredTime.setHours(lastShiftStart.getHours())
  preferredTime.setMinutes(lastShiftStart.getMinutes())
  preferredTime.setSeconds(0)
  return fromTime > preferredTime ? addHours(preferredTime, 24) : preferredTime
}

export function findGaps({ shift, from, to }) {
  const gaps = []
  let currentTime = new Date(from)
  const endTime = new Date(to)

  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  for (const service of shift.services) {
    const serviceStart = new Date(service.start)
    const serviceEnd = new Date(service.end)

    if (serviceStart > currentTime) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
      })
    }

    currentTime = serviceEnd > currentTime ? serviceEnd : currentTime
  }

  if (endTime > currentTime) {
    gaps.push({
      start: currentTime,
      end: endTime,
    })
  }

  return gaps
}
