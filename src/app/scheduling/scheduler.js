// /src/app/scheduling/scheduler.js
import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { findGaps, canFitInGap } from '../utils/gaps.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import { findBestPosition, updateDistances } from './optimize.js'
import {
  createNewShiftWithConsistentStartTime,
  countShiftsInWeek,
} from './shifts.js'

/**
 * Schedules a service across available technicians or creates a new technician if necessary.
 * @param {Object} params - The scheduling parameters
 * @param {Object} params.service - The service to be scheduled
 * @param {Object} params.techSchedules - Current schedules of all technicians
 * @param {Array} params.remainingServices - List of services yet to be scheduled
 * @returns {Object} Result of scheduling attempt
 */
export async function scheduleService({
  service,
  techSchedules,
  remainingServices,
}) {
  // Early validation
  if (!service.time?.range?.[0] || !service.time?.range?.[1]) {
    console.log(
      'Invalid time range for service:',
      service.id,
      service.time?.range,
    )
    return { scheduled: false, reason: 'Invalid time range' }
  }

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

  // If no existing tech can accommodate, create a new tech
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

/**
 * Attempts to schedule a service for a specific technician.
 * Tries existing shifts, then attempts to create a new shift if possible.
 * @param {Object} params - The scheduling parameters
 * @returns {Object} Result of scheduling attempt
 */
async function tryScheduleForTech({
  service,
  techId,
  techSchedules,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]

  // Sort shifts by end time to find the earliest available shift
  const sortedShifts = techSchedule.shifts.sort(
    (a, b) => new Date(a.shiftEnd) - new Date(b.shiftEnd),
  )

  for (const shift of sortedShifts) {
    const result = await tryScheduleInShift({
      service,
      shift,
      techId,
      techSchedules,
    })
    if (result.scheduled) {
      return {
        scheduled: true,
        reason: `Scheduled in existing shift for Tech ${techId}`,
      }
    }
  }

  // Check if a new shift can be created
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
      techSchedules,
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

/**
 * Attempts to schedule a service within a specific shift.
 * Checks for available time slots and ensures shift constraints are met.
 * @param {Object} params - The scheduling parameters
 * @returns {Object} Result of scheduling attempt
 */
async function tryScheduleInShift({ service, shift, techId, techSchedules }) {
  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const shiftStart = new Date(shift.shiftStart)
  const shiftEnd = new Date(shift.shiftEnd)

  // Pre-calculate all existing service time ranges once
  const existingServiceRanges = shift.services.map(existingService => ({
    start: new Date(existingService.start),
    end: new Date(existingService.end),
  }))

  // Pre-calculate total shift minutes
  const currentShiftMinutes = shift.services.reduce(
    (acc, srv) => acc + srv.time.duration,
    0,
  )

  // Early exit if shift would exceed max hours
  if (currentShiftMinutes + serviceDuration > MAX_SHIFT_HOURS * 60) {
    return { scheduled: false }
  }

  const startTime = max(shiftStart, rangeStart)
  const latestPossibleStart = min(
    shiftEnd,
    rangeEnd,
    addHours(shiftStart, MAX_SHIFT_HOURS),
  )
  latestPossibleStart.setMinutes(
    latestPossibleStart.getMinutes() - serviceDuration,
  )

  // Find all possible gaps first
  const gaps = findGaps({
    shift: { ...shift, services: existingServiceRanges },
    from: startTime,
    to: latestPossibleStart,
  })

  // Try to schedule in each gap
  for (const gap of gaps) {
    if (gap.end - gap.start >= serviceDuration * 60 * 1000) {
      // Convert minutes to milliseconds
      const scheduledService = {
        ...service,
        start: gap.start,
        end: addMinutes(gap.start, serviceDuration),
      }

      shift.services.push(scheduledService)
      await updateDistances(shift.services)

      if (scheduledService.end > shift.shiftEnd) {
        shift.shiftEnd = scheduledService.end
      }

      return { scheduled: true }
    }
  }

  return { scheduled: false }
}

/**
 * Checks if a service can be scheduled at a specific time within a shift.
 * Ensures no conflicts with existing services and shift duration constraints.
 * @param {Object} shift - The shift to check
 * @param {Date} startTime - Proposed start time for the service
 * @param {Date} endTime - Proposed end time for the service
 * @param {Object} service - The service to be scheduled
 * @returns {boolean} Whether the service can be scheduled at the given time
 */
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

  // Additional Check: Ensure total shift hours do not exceed MAX_SHIFT_HOURS
  const totalShiftMinutes =
    shift.services.reduce((acc, srv) => acc + srv.time.duration, 0) +
    service.time.duration
  if (totalShiftMinutes > MAX_SHIFT_HOURS * 60) {
    return false
  }

  return true
}

/**
 * Schedules an enforced service for a specific technician.
 * Creates a new shift if necessary and optimizes service placement within the shift.
 * @param {Object} params - The scheduling parameters
 * @returns {Object} Result of scheduling attempt
 */
export async function scheduleEnforcedService({ service, techSchedules }) {
  const techId = service.tech.code
  if (!techSchedules[techId]) techSchedules[techId] = { shifts: [] }

  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const preferredTime = new Date(service.time.preferred)

  const startTime = preferredTime
  const endTime = addMinutes(startTime, serviceDuration)

  let targetShift = techSchedules[techId].shifts.find(
    shift => startTime >= shift.shiftStart && endTime <= shift.shiftEnd,
  )

  if (!targetShift) {
    targetShift = {
      shiftStart: startTime,
      shiftEnd: addHours(startTime, MAX_SHIFT_HOURS),
      services: [],
    }
    techSchedules[techId].shifts.push(targetShift)
  }

  const scheduledService = { ...service, start: startTime, end: endTime }

  // Find the best position to insert the new service
  const bestPosition = await findBestPosition(targetShift, scheduledService)

  // Insert the service at the best position
  targetShift.services.splice(bestPosition, 0, scheduledService)

  // Update distances and previous companies for all services in the shift
  await updateDistances(targetShift.services)

  return { scheduled: true }
}
