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
    const preferredStartTime = ensureDayjs(lastShift.shiftEnd).add(16, 'hour')

    // Look for services within the preferred 16-hour window
    const servicesWithinWindow = remainingServices.filter(s =>
      ensureDayjs(s.time.range[0]).isBetween(
        minStartTime,
        preferredStartTime,
        null,
        '[]',
      ),
    )

    if (servicesWithinWindow.length > 0) {
      // If there are services within the window, start the shift at the earliest service
      newShiftStart = dayjs.min(
        servicesWithinWindow.map(s => ensureDayjs(s.time.range[0])),
      )
    } else {
      // If no services within the window, use the current service start time, but cap the gap
      newShiftStart = dayjs.min([
        dayjs.max([newShiftStart, minStartTime]),
        ensureDayjs(lastShift.shiftEnd).add(MAX_SHIFT_GAP, 'hours'),
      ])
    }
  }

  return {
    shiftStart: newShiftStart,
    shiftEnd: newShiftStart.add(MAX_SHIFT_HOURS, 'hours'),
    services: [],
  }
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
