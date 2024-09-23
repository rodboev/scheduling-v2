import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import { calcDistance } from './index.js'
import {
  createNewShiftWithConsistentStartTime,
  countShiftsInWeek,
} from './shiftManagement.js'

export function scheduleService({ service, techSchedules, remainingServices }) {
  // Sort techs by the number of shifts they have, in descending order
  const sortedTechs = Object.keys(techSchedules).sort(
    (a, b) => techSchedules[b].shifts.length - techSchedules[a].shifts.length,
  )

  for (const techId of sortedTechs) {
    const result = tryScheduleForTech({
      service,
      techId,
      techSchedules,
      remainingServices,
    })

    if (result.scheduled) {
      // Find the previous service for this tech
      const techSchedule = techSchedules[techId]
      const allServices = techSchedule.shifts.flatMap(shift => shift.services)
      const scheduledServiceIndex = allServices.findIndex(
        s => s.id === service.id,
      )
      if (scheduledServiceIndex > 0) {
        const previousService = allServices[scheduledServiceIndex - 1]
        service.previousCompany = previousService.company
        service.distanceFromPrevious = calcDistance(
          previousService.location,
          service.location,
        )
      }
      return result
    }
  }

  // If we couldn't schedule on existing techs, create a new tech and try to schedule
  const newTechId = `Tech ${Object.keys(techSchedules).length + 1}`
  techSchedules[newTechId] = { shifts: [] }
  const result = tryScheduleForTech({
    service,
    techId: newTechId,
    techSchedules,
    remainingServices,
  })

  if (result.scheduled) return result

  // If we reach this point, the service couldn't be scheduled
  return {
    scheduled: false,
    reason: "Couldn't be scheduled with any tech or in a new shift",
  }
}

function tryScheduleForTech({
  service,
  techId,
  techSchedules,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]

  // Try to fit the service into an existing shift
  for (
    let shiftIndex = 0;
    shiftIndex < techSchedule.shifts.length;
    shiftIndex++
  ) {
    const shift = techSchedule.shifts[shiftIndex]
    const result = tryScheduleInShift({
      service,
      shift,
      techId,
    })

    if (result.scheduled) {
      updateDistanceInfo(shift, result.index)
      return {
        scheduled: true,
        reason: `Scheduled in existing shift for Tech ${techId}`,
      }
    }
  }

  // If we couldn't schedule in existing shifts, try creating a new shift
  const weekStart = new Date(service.time.range[0])
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Set to the start of the week (Sunday)
  weekStart.setHours(0, 0, 0, 0)
  const shiftsThisWeek = countShiftsInWeek(techSchedule, weekStart)

  if (shiftsThisWeek < 5) {
    // If not possible, try creating a new shift
    const newShift = createNewShiftWithConsistentStartTime({
      techSchedule,
      rangeStart: new Date(service.time.range[0]),
      remainingServices,
    })

    if (tryScheduleInShift({ service, shift: newShift, techId })) {
      techSchedule.shifts.push(newShift)
      updateDistanceInfo(newShift, newShift.services.length - 1)
      return {
        scheduled: true,
        reason: `Scheduled in new shift for Tech ${techId}`,
      }
    }
  }

  return { scheduled: false, reason: `No time in any shift for Tech ${techId}` }
}

function tryScheduleInShift({ service, shift, techId }) {
  const [rangeStart, rangeEnd] = service.time.range.map(date => new Date(date))
  const serviceDuration = service.time.duration
  const shiftStart = new Date(shift.shiftStart)
  const shiftEnd = new Date(shift.shiftEnd)

  // Ensure the service starts no earlier than its range start and the shift start
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
    let endTime = addMinutes(startTime, serviceDuration)

    // Ensure the service doesn't extend beyond MAX_SHIFT_HOURS
    if (endTime > addHours(shiftStart, MAX_SHIFT_HOURS)) {
      return false
    }

    let canSchedule = true

    // Check if this time slot conflicts with any existing services
    for (const existingService of shift.services) {
      const existingStart = new Date(existingService.start)
      const existingEnd = new Date(existingService.end)

      if (
        (startTime >= existingStart && startTime < existingEnd) ||
        (endTime > existingStart && endTime <= existingEnd) ||
        (startTime < existingStart && endTime > existingEnd)
      ) {
        canSchedule = false
        break
      }
    }

    if (canSchedule) {
      // We found a suitable time slot, schedule the service
      const scheduledService = {
        ...service,
        start: startTime,
        end: endTime,
      }

      // Find the best position to insert the service based on geographical proximity
      const insertIndex = findBestInsertionPoint(
        shift.services,
        scheduledService,
      )
      shift.services.splice(insertIndex, 0, scheduledService)

      // Update shift end time if necessary
      if (endTime > shiftEnd) {
        shift.shiftEnd = endTime
      }

      updateDistanceInfo(shift)
      return { scheduled: true }
    }

    // If we can't schedule at this time, try 15 minutes later
    startTime = addMinutes(startTime, 15)
  }

  // If we've tried all possible start times and couldn't schedule, return false
  return false
}

function findBestInsertionPoint(services, newService) {
  if (services.length === 0) return 0

  let bestIndex = 0
  let minDistanceIncrease = Infinity

  for (let i = 0; i <= services.length; i++) {
    let distanceIncrease = 0

    if (i > 0) {
      distanceIncrease += calcDistance(
        services[i - 1].location,
        newService.location,
      )
    }
    if (i < services.length) {
      distanceIncrease += calcDistance(
        newService.location,
        services[i].location,
      )
    }
    if (i > 0 && i < services.length) {
      distanceIncrease -= calcDistance(
        services[i - 1].location,
        services[i].location,
      )
    }

    if (distanceIncrease < minDistanceIncrease) {
      minDistanceIncrease = distanceIncrease
      bestIndex = i
    }
  }

  return bestIndex
}

function updateDistanceInfo(shift) {
  const services = shift.services
  services.sort((a, b) => new Date(a.start) - new Date(b.start))

  for (let i = 1; i < services.length; i++) {
    const currentService = services[i]
    const previousService = services[i - 1]
    currentService.previousCompany = previousService.company
    currentService.distanceFromPrevious = calcDistance(
      previousService.location,
      currentService.location,
    )
  }

  // Clear distance info for the first service in the shift
  if (services.length > 0) {
    delete services[0].previousCompany
    delete services[0].distanceFromPrevious
  }
}

export function scheduleEnforcedService({ service, techSchedules }) {
  const techId = service.tech.code
  if (!techSchedules[techId]) {
    techSchedules[techId] = { shifts: [] }
  }

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
  targetShift.services.push(scheduledService)
  targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  updateDistanceInfo(targetShift)

  return { scheduled: true }
}
