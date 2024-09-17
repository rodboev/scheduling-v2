import {
  MIN_REST_HOURS,
  MAX_SHIFT_GAP,
  MAX_SHIFT_HOURS,
} from '@/app/scheduling'
import { dayjsInstance as dayjs, ensureDayjs } from '@/app/utils/dayjs'

export function compactShift(shift) {
  shift.services.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

  // First pass: Move services forward
  for (let i = 0; i < shift.services.length - 1; i++) {
    const currentService = shift.services[i]
    const nextService = shift.services[i + 1]

    const currentEnd = ensureDayjs(currentService.end)
    const nextStart = ensureDayjs(nextService.start)
    const earliestPossibleStart = ensureDayjs(currentService.time.range[0])

    if (nextStart.isAfter(currentEnd)) {
      const latestPossibleStart = dayjs.min(
        nextStart.subtract(currentService.time.duration, 'minute'),
        ensureDayjs(currentService.time.range[1]).subtract(
          currentService.time.duration,
          'minute',
        ),
      )

      if (latestPossibleStart.isAfter(earliestPossibleStart)) {
        const newStart = dayjs.max(earliestPossibleStart, latestPossibleStart)
        const newEnd = newStart.add(currentService.time.duration, 'minute')
        currentService.start = newStart.toDate()
        currentService.end = newEnd.toDate()
      }
    }
  }

  // Second pass: Move services backward
  for (let i = shift.services.length - 1; i > 0; i--) {
    const currentService = shift.services[i]
    const previousService = shift.services[i - 1]

    const currentStart = ensureDayjs(currentService.start)
    const previousEnd = ensureDayjs(previousService.end)
    const latestPossibleEnd = ensureDayjs(currentService.time.range[1])

    if (currentStart.isAfter(previousEnd)) {
      const earliestPossibleStart = dayjs.max(
        previousEnd,
        ensureDayjs(currentService.time.range[0]),
      )

      if (earliestPossibleStart.isBefore(currentStart)) {
        const newStart = earliestPossibleStart
        const newEnd = dayjs.min(
          newStart.add(currentService.time.duration, 'minute'),
          latestPossibleEnd,
        )
        currentService.start = newStart.toDate()
        currentService.end = newEnd.toDate()
      }
    }
  }
}

export function fillGaps(shift) {
  shift.services.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

  for (let i = 1; i < shift.services.length; i++) {
    const currentService = shift.services[i]
    const previousService = shift.services[i - 1]
    const currentStart = ensureDayjs(currentService.start)
    const previousEnd = ensureDayjs(previousService.end)

    if (currentStart.isAfter(previousEnd)) {
      const earliestPossibleStart = dayjs.max(
        previousEnd,
        ensureDayjs(currentService.time.range[0]),
      )
      if (earliestPossibleStart.isBefore(currentStart)) {
        const newStart = earliestPossibleStart
        const newEnd = newStart.add(currentService.time.duration, 'minute')
        currentService.start = newStart.toDate()
        currentService.end = newEnd.toDate()
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
  let newShiftStart = ensureDayjs(rangeStart)
  if (lastShift) {
    const minStartTime = ensureDayjs(lastShift.shiftEnd).add(
      MIN_REST_HOURS,
      'hour',
    )
    newShiftStart = dayjs.max(newShiftStart, minStartTime)
  }

  return {
    shiftStart: newShiftStart.toDate(),
    shiftEnd: newShiftStart.add(MAX_SHIFT_HOURS, 'hours').toDate(),
    services: [],
  }
}

export function createNewShiftWithConsistentStartTime({
  techSchedule,
  rangeStart,
  remainingServices,
}) {
  const lastShift = techSchedule.shifts[techSchedule.shifts.length - 1]
  let newShiftStart = ensureDayjs(rangeStart)

  if (lastShift) {
    const lastShiftEnd = ensureDayjs(lastShift.shiftEnd)
    const minStartTime = lastShiftEnd.add(MIN_REST_HOURS, 'hour')

    // If the range start is before the minimum start time, use the minimum start time
    if (newShiftStart.isBefore(minStartTime)) {
      newShiftStart = minStartTime
    }

    // If the new shift would start more than MAX_SHIFT_GAP hours after the last shift,
    // try to find a service that starts earlier
    if (newShiftStart.diff(lastShiftEnd, 'hour') > MAX_SHIFT_GAP) {
      const earlierService = remainingServices.find(
        s =>
          ensureDayjs(s.time.range[0]).isBefore(newShiftStart) &&
          ensureDayjs(s.time.range[0]).isAfter(minStartTime),
      )
      if (earlierService) {
        newShiftStart = ensureDayjs(earlierService.time.range[0])
      }
    }
  }

  return {
    shiftStart: newShiftStart.toDate(),
    shiftEnd: newShiftStart.add(MAX_SHIFT_HOURS, 'hours').toDate(),
    services: [],
  }
}

function getNextPreferredStartTime(fromTime, lastShiftStart) {
  const preferredTime = lastShiftStart
    .hour(lastShiftStart.hour())
    .minute(lastShiftStart.minute())
    .second(0)
  return fromTime.isAfter(preferredTime)
    ? preferredTime.add(24, 'hours')
    : preferredTime
}

export function findGaps({ shift, from, to }) {
  const gaps = []
  let currentTime = ensureDayjs(from)
  const endTime = ensureDayjs(to)

  shift.services.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  for (const service of shift.services) {
    const serviceStart = ensureDayjs(service.start)
    const serviceEnd = ensureDayjs(service.end)

    if (serviceStart.isAfter(currentTime)) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
      })
    }

    currentTime = serviceEnd.isAfter(currentTime) ? serviceEnd : currentTime
  }

  if (endTime.isAfter(currentTime)) {
    gaps.push({
      start: currentTime,
      end: endTime,
    })
  }

  return gaps
}
