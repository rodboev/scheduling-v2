// /src/app/scheduling/scheduler.js
import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import { findBestPosition, updateDistances } from './optimize.js'
import { createNewShiftWithConsistentStartTime, countShiftsInWeek } from './shifts.js'

const SERVICE_GAP_MINUTES = 15

function addGapToEndTime(endTime, nextServiceStart) {
  const gapEndTime = addMinutes(endTime, SERVICE_GAP_MINUTES)
  return nextServiceStart ? min(gapEndTime, new Date(nextServiceStart)) : gapEndTime
}

/**
 * Schedules a service across available technicians or creates a new technician if necessary.
 * @param {Object} params - The scheduling parameters
 * @param {Object} params.service - The service to be scheduled
 * @param {Object} params.techSchedules - Current schedules of all technicians
 * @param {Array} params.remainingServices - List of services yet to be scheduled
 * @returns {Object} Result of scheduling attempt
 */
export async function scheduleService({ service, techSchedules, remainingServices }) {
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
async function tryScheduleForTech({ service, techId, techSchedules, remainingServices }) {
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
 * Attempts to schedule a service in an existing shift
 */
async function tryScheduleInShift({ service, shift, techId }) {
  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const shiftStart = shift.shiftStart
  const shiftEnd = shift.shiftEnd

  let startTime = max(shiftStart, rangeStart)
  const latestPossibleStart = min(shiftEnd, rangeEnd, addHours(shiftStart, MAX_SHIFT_HOURS))
  latestPossibleStart.setMinutes(latestPossibleStart.getMinutes() - serviceDuration)

  // Check if adding this service would exceed shift duration
  const totalMinutesWithGaps = shift.services.reduce((total, svc) => {
    return total + svc.time.duration + SERVICE_GAP_MINUTES
  }, 0)

  if (totalMinutesWithGaps + serviceDuration + SERVICE_GAP_MINUTES > MAX_SHIFT_HOURS * 60) {
    return { scheduled: false, reason: 'Shift would exceed maximum duration' }
  }

  while (startTime <= latestPossibleStart) {
    const endTime = addMinutes(startTime, serviceDuration)

    // Check if this slot conflicts with any existing service
    let hasConflict = false
    for (const existingService of shift.services) {
      const existingStart = new Date(existingService.start)
      const existingEnd = new Date(existingService.end)

      // Calculate gaps between services
      const gapBefore = (startTime - existingEnd) / 60000
      const gapAfter = (existingStart - endTime) / 60000

      // Check for conflicts including required gaps
      if (
        // Overlapping time periods
        (startTime < existingEnd && endTime > existingStart) ||
        // Insufficient gap before existing service
        (gapAfter >= 0 && gapAfter < SERVICE_GAP_MINUTES) ||
        // Insufficient gap after existing service
        (gapBefore >= 0 && gapBefore < SERVICE_GAP_MINUTES)
      ) {
        hasConflict = true
        // Move start time to the next possible slot after this service
        startTime = addMinutes(existingEnd, SERVICE_GAP_MINUTES)
        break
      }
    }

    if (!hasConflict && endTime <= rangeEnd) {
      const scheduledService = {
        ...service,
        start: startTime,
        end: endTime,
        resourceId: techId,
      }

      // Insert service in chronological order
      const insertIndex = shift.services.findIndex(s => new Date(s.start) > startTime)
      const insertAt = insertIndex === -1 ? shift.services.length : insertIndex
      shift.services.splice(insertAt, 0, scheduledService)

      await updateDistances(shift.services)
      return { scheduled: true }
    }

    // If no conflict but can't schedule here, try the next potential slot
    if (!hasConflict) {
      startTime = addMinutes(startTime, SERVICE_GAP_MINUTES)
    }
  }

  return { scheduled: false, reason: 'No valid time slot found' }
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
    shift.services.reduce((acc, srv) => acc + srv.time.duration, 0) + service.time.duration
  if (totalShiftMinutes > MAX_SHIFT_HOURS * 60) {
    return false
  }

  return true
}

/**
 * Checks if a service can be added to a shift
 */
function canAddServiceToShift(shift, service, startTime) {
  // Check if shift has any services
  if (shift.services.length === 0) {
    const endTime = addMinutes(startTime, service.time.duration)
    return endTime <= shift.shiftEnd
  }

  // Check if service fits between existing services with 15 min gaps
  for (let i = 0; i < shift.services.length; i++) {
    const currentService = shift.services[i]
    const prevService = shift.services[i - 1]

    // Check gap after previous service
    if (prevService) {
      const gapAfterPrev = (new Date(startTime) - new Date(prevService.end)) / 60000
      if (gapAfterPrev < SERVICE_GAP_MINUTES) return false
    }

    // Check gap before next service
    if (currentService) {
      const gapBeforeNext =
        (new Date(currentService.start) - new Date(addMinutes(startTime, service.time.duration))) /
        60000
      if (gapBeforeNext < SERVICE_GAP_MINUTES) return false
    }
  }

  // Additional Check: Ensure total shift hours do not exceed MAX_SHIFT_HOURS
  const totalShiftMinutes =
    shift.services.reduce((acc, srv) => acc + srv.time.duration, 0) +
    service.time.duration +
    shift.services.length * SERVICE_GAP_MINUTES // Account for gaps

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

  // Find a shift that can accommodate the service with gaps
  let targetShift = techSchedules[techId].shifts.find(shift => {
    // Check if shift can accommodate service with gaps
    const startTime = preferredTime
    const endTime = addMinutes(startTime, serviceDuration)

    if (startTime < shift.shiftStart || endTime > shift.shiftEnd) return false

    // Check gaps with existing services
    for (const existingService of shift.services) {
      const gapAfterExisting = (startTime - new Date(existingService.end)) / 60000
      const gapBeforeExisting = (new Date(existingService.start) - endTime) / 60000

      if (gapAfterExisting > 0 && gapAfterExisting < SERVICE_GAP_MINUTES) return false
      if (gapBeforeExisting > 0 && gapBeforeExisting < SERVICE_GAP_MINUTES) return false
    }

    return true
  })

  if (!targetShift) {
    targetShift = {
      shiftStart: preferredTime,
      shiftEnd: addHours(preferredTime, MAX_SHIFT_HOURS),
      services: [],
    }
    techSchedules[techId].shifts.push(targetShift)
  }

  const scheduledService = {
    ...service,
    start: preferredTime,
    end: addMinutes(preferredTime, serviceDuration),
  }
  const bestPosition = await findBestPosition(targetShift, scheduledService)
  targetShift.services.splice(bestPosition, 0, scheduledService)
  await updateDistances(targetShift.services)

  return { scheduled: true }
}
