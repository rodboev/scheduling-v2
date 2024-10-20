import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import { findBestPosition, updateShiftDistances } from './optimize.js'
import {
  createNewShiftWithConsistentStartTime,
  countShiftsInWeek,
} from './shifts.js'

export async function scheduleService({
  service,
  techSchedules,
  remainingServices,
}) {
  const sortedTechs = Object.keys(techSchedules).sort(
    (a, b) => techSchedules[b].shifts.length - techSchedules[a].shifts.length,
  )

  for (const techId of sortedTechs) {
    const result = await tryScheduleForTech({
      service,
      techId,
      techSchedules,
      remainingServices,
    })

    if (result.scheduled) return result
  }

  const newTechId = `Tech ${Object.keys(techSchedules).length + 1}`
  techSchedules[newTechId] = { shifts: [] }
  const result = await tryScheduleForTech({
    service,
    techId: newTechId,
    techSchedules,
    remainingServices,
  })

  if (result.scheduled) return result

  return {
    scheduled: false,
    reason: "Couldn't be scheduled with any tech or in a new shift",
  }
}

async function tryScheduleForTech({
  service,
  techId,
  techSchedules,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]

  for (
    let shiftIndex = 0;
    shiftIndex < techSchedule.shifts.length;
    shiftIndex++
  ) {
    const shift = techSchedule.shifts[shiftIndex]
    const result = await tryScheduleInShift({
      service,
      shift,
      techId,
    })
    if (result.scheduled) {
      return {
        scheduled: true,
        reason: `Scheduled in existing shift for Tech ${techId}`,
      }
    }
  }

  const weekStart = new Date(service.time.range[0])
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const shiftsThisWeek = countShiftsInWeek(techSchedule, weekStart)

  if (shiftsThisWeek < 5) {
    const newShift = createNewShiftWithConsistentStartTime({
      techSchedule,
      rangeStart: new Date(service.time.range[0]),
      remainingServices,
    })

    const result = await tryScheduleInShift({
      service,
      shift: newShift,
      techId,
    })
    if (result.scheduled) {
      techSchedule.shifts.push(newShift)
      return {
        scheduled: true,
        reason: `Scheduled in new shift for Tech ${techId}`,
      }
    }
  }

  return { scheduled: false, reason: `No time in any shift for Tech ${techId}` }
}

async function tryScheduleInShift({ service, shift, techId }) {
  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const shiftStart = new Date(shift.shiftStart)
  const shiftEnd = new Date(shift.shiftEnd)

  let startTime = max(shiftStart, rangeStart)
  const latestPossibleStart = min(
    shiftEnd,
    rangeEnd,
    addHours(shiftStart, MAX_SHIFT_HOURS),
  )
  latestPossibleStart.setMinutes(
    latestPossibleStart.getMinutes() - serviceDuration,
  )

  while (startTime <= latestPossibleStart) {
    const endTime = addMinutes(startTime, serviceDuration)

    if (
      endTime <= rangeEnd &&
      (await canScheduleAtTime(shift, startTime, endTime, service))
    ) {
      const scheduledService = {
        ...service,
        start: startTime,
        end: endTime,
      }

      // // Find the best position to insert the new service
      // const bestPosition = await findBestPosition(shift, scheduledService)

      // // Insert the service at the best position
      // shift.services.splice(bestPosition, 0, scheduledService)

      // Update distances for the shift
      await updateShiftDistances(shift)

      if (endTime > shift.shiftEnd) shift.shiftEnd = endTime

      return { scheduled: true }
    }

    startTime = addMinutes(startTime, 15)
  }

  return { scheduled: false }
}

async function canScheduleAtTime(shift, startTime, endTime, service) {
  for (const existingService of shift.services) {
    const existingStart = new Date(existingService.start)
    const existingEnd = new Date(existingService.end)

    if (
      (startTime >= existingStart && startTime < existingEnd) ||
      (endTime > existingStart && endTime <= existingEnd) ||
      (startTime < existingStart && endTime > existingEnd)
    ) {
      return false
    }
  }

  return true
}

export async function scheduleEnforcedService({ service, techSchedules }) {
  const techId = service.tech.code
  if (!techSchedules[techId]) techSchedules[techId] = { shifts: [] }

  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const preferredTime = new Date(service.time.preferred)

  const startTime = preferredTime
  const endTime = addMinutes(startTime, serviceDuration)

  let targetShift
  for (let shift of techSchedules[techId].shifts) {
    if (startTime >= shift.shiftStart && endTime <= shift.shiftEnd) {
      targetShift = shift
      break
    }
  }

  if (!targetShift) {
    targetShift = {
      shiftStart: startTime,
      shiftEnd: addHours(startTime, MAX_SHIFT_HOURS),
      services: [],
    }
    techSchedules[techId].shifts.push(targetShift)
  }

  const scheduledService = {
    ...service,
    start: startTime,
    end: endTime,
  }

  // Find the best position to insert the new service
  const bestPosition = await findBestPosition(targetShift, scheduledService)

  // Insert the service at the best position
  targetShift.services.splice(bestPosition, 0, scheduledService)

  // Update distances and previous companies for all services in the shift
  await updateShiftDistances(targetShift)

  return { scheduled: true }
}
