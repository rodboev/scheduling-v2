// /src/app/scheduling/shifts.js
import { addHours, max, min } from '../utils/dateHelpers.js'
import { findGaps } from '../utils/gaps.js'
import { MIN_REST_HOURS, MAX_SHIFT_GAP, MAX_SHIFT_HOURS } from './index.js'

export function flattenServices(techSchedules) {
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

export function createNewShift({ techSchedule, rangeStart }) {
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

    if (newShiftStart < minStartTime) {
      newShiftStart = minStartTime
    }

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

  const weekStart = new Date(newShiftStart)
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  weekStart.setHours(0, 0, 0, 0)
  const shiftsThisWeek = countShiftsInWeek(techSchedule, weekStart)

  if (shiftsThisWeek >= 5) {
    newShiftStart = new Date(weekStart)
    newShiftStart.setDate(newShiftStart.getDate() + 7)
  }

  return {
    shiftStart: newShiftStart,
    shiftEnd: addHours(newShiftStart, MAX_SHIFT_HOURS),
    services: [],
  }
}

export function countShiftsInWeek(techSchedule, weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return techSchedule.shifts.filter(shift => {
    const shiftStart = new Date(shift.shiftStart)
    return shiftStart >= weekStart && shiftStart < weekEnd
  }).length
}
