import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from '@/app/scheduling'
import {
  createNewShift,
  compactShift,
  fillGaps,
  findGaps,
  createNewShiftWithConsistentStartTime,
} from '@/app/scheduling/shiftManagement'
import { dayjsInstance as dayjs, ensureDayjs } from '@/app/utils/dayjs'

export function scheduleService({
  service,
  techSchedules,
  scheduledServiceIdsByDate,
  nextGenericTechId,
  remainingServices,
}) {
  // Sort techs by the number of shifts they have, in descending order
  const sortedTechs = Object.keys(techSchedules).sort(
    (a, b) => techSchedules[b].shifts.length - techSchedules[a].shifts.length,
  )

  // Try to schedule on existing techs, first in existing shifts, then allowing new shifts
  for (const techId of sortedTechs) {
    // First, try to schedule in existing shifts
    const resultExisting = scheduleForTech({
      service,
      techId,
      techSchedules,
      scheduledServiceIdsByDate,
      allowNewShift: false,
      remainingServices,
    })

    if (resultExisting.scheduled) return resultExisting

    // If not possible, try allowing a new shift
    const resultNew = scheduleForTech({
      service,
      techId,
      techSchedules,
      scheduledServiceIdsByDate,
      allowNewShift: true,
      remainingServices,
    })

    if (resultNew.scheduled) return resultNew
  }

  // If we couldn't schedule on existing techs, create a new tech and try to schedule
  const newTechId = `Tech ${nextGenericTechId}`
  techSchedules[newTechId] = { shifts: [] }
  const result = scheduleForTech({
    service,
    techId: newTechId,
    techSchedules,
    scheduledServiceIdsByDate,
    allowNewShift: true,
    remainingServices,
  })

  if (result.scheduled) return result

  // If we reach this point, the service couldn't be scheduled
  return {
    scheduled: false,
    reason: "Couldn't be scheduled with any tech or in a new shift",
  }
}

function scheduleForTech({
  service,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
  allowNewShift,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]
  const [rangeStart, rangeEnd] = service.time.range.map(ensureDayjs)

  // Try to fit the service into an existing shift
  for (
    let shiftIndex = 0;
    shiftIndex < techSchedule.shifts.length;
    shiftIndex++
  ) {
    let shift = techSchedule.shifts[shiftIndex]
    if (
      tryScheduleInShift({ service, shift, scheduledServiceIdsByDate, techId })
    ) {
      compactShift(shift)
      fillGaps(shift)
      return {
        scheduled: true,
        reason: `Scheduled in existing shift for Tech ${techId}`,
      }
    }
  }

  // If allowed, try to create a new shift
  if (allowNewShift) {
    const newShift = createNewShiftWithConsistentStartTime({
      techSchedule,
      rangeStart,
      remainingServices,
    })

    // Safeguard: ensure the new shift starts within the service's time range
    if (ensureDayjs(newShift.shiftStart).isAfter(rangeEnd)) {
      return {
        scheduled: false,
        reason: `New shift would start after service's time range for Tech ${techId}`,
      }
    }

    if (
      tryScheduleInShift({
        service,
        shift: newShift,
        scheduledServiceIdsByDate,
        techId,
      })
    ) {
      techSchedule.shifts.push(newShift)
      compactShift(newShift)
      fillGaps(newShift)
      return {
        scheduled: true,
        reason: `Scheduled in new shift for Tech ${techId}`,
      }
    }
  }

  return { scheduled: false, reason: `No time in any shift for Tech ${techId}` }
}

function tryScheduleInShift({
  service,
  shift,
  scheduledServiceIdsByDate,
  techId,
}) {
  const [rangeStart, rangeEnd] = service.time.range.map(ensureDayjs)
  const serviceDuration = service.time.duration
  const shiftStart = ensureDayjs(shift.shiftStart)
  const shiftEnd = ensureDayjs(shift.shiftEnd)

  // Ensure the service starts no earlier than its range start and the shift start
  let startTime = dayjs.max(shiftStart, rangeStart)
  const latestPossibleStart = dayjs
    .min(shiftEnd, rangeEnd, shiftStart.add(MAX_SHIFT_HOURS, 'hours'))
    .subtract(serviceDuration, 'minute')

  while (startTime.isSameOrBefore(latestPossibleStart)) {
    let endTime = startTime.add(serviceDuration, 'minute')

    // Ensure the service doesn't extend beyond MAX_SHIFT_HOURS
    if (endTime.isAfter(shiftStart.add(MAX_SHIFT_HOURS, 'hours'))) {
      return false
    }

    let canSchedule = true

    // Check if this time slot conflicts with any existing services
    for (const existingService of shift.services) {
      const existingStart = ensureDayjs(existingService.start)
      const existingEnd = ensureDayjs(existingService.end)

      if (
        (startTime.isSameOrAfter(existingStart) &&
          startTime.isBefore(existingEnd)) ||
        (endTime.isAfter(existingStart) &&
          endTime.isSameOrBefore(existingEnd)) ||
        (startTime.isBefore(existingStart) && endTime.isAfter(existingEnd))
      ) {
        canSchedule = false
        break
      }
    }

    if (canSchedule) {
      // We found a suitable time slot, schedule the service
      const scheduledService = {
        ...service,
        start: startTime.toDate(),
        end: endTime.toDate(),
      }

      shift.services.push(scheduledService)
      shift.services.sort((a, b) =>
        ensureDayjs(a.start).diff(ensureDayjs(b.start)),
      )

      const serviceDate = startTime.format('YYYY-MM-DD')
      const serviceKey = `${service.id}-${serviceDate}`
      scheduledServiceIdsByDate.set(serviceKey, techId)

      // Update shift end time if necessary
      if (endTime.isAfter(shiftEnd)) {
        shift.shiftEnd = endTime.toDate()
      }

      return true
    }

    // If we can't schedule at this time, try 15 minutes later
    startTime = startTime.add(15, 'minute')
  }

  // If we've tried all possible start times and couldn't schedule, return false
  return false
}

export function scheduleEnforcedService({
  service,
  techSchedules,
  scheduledServiceIdsByDate,
}) {
  const techId = service.tech.code
  if (!techSchedules[techId]) {
    techSchedules[techId] = { shifts: [] }
  }

  const [rangeStart, rangeEnd] = service.time.range
  const serviceDuration = service.time.duration
  const preferredTime = service.time.preferred

  const startTime = preferredTime
  const endTime = startTime.add(serviceDuration, 'minute')

  let targetShift
  for (let shift of techSchedules[techId].shifts) {
    if (
      startTime.isSameOrAfter(shift.shiftStart) &&
      endTime.isSameOrBefore(shift.shiftEnd)
    ) {
      targetShift = shift
      break
    }
  }

  if (!targetShift) {
    targetShift = {
      shiftStart: startTime,
      shiftEnd: startTime.add(MAX_SHIFT_HOURS, 'hours'),
      services: [],
    }
    techSchedules[techId].shifts.push(targetShift)
  }

  const scheduledService = {
    ...service,
    start: startTime.toDate(),
    end: endTime.toDate(),
  }
  targetShift.services.push(scheduledService)
  targetShift.services.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  const serviceDate = startTime.format('YYYY-MM-DD')
  const serviceKey = `${service.id}-${serviceDate}`
  scheduledServiceIdsByDate.set(serviceKey, techId)

  return { scheduled: true }
}
