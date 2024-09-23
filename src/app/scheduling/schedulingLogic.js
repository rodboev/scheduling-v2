import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import { calcDistance } from './index.js'
import {
  sortServicesByTimeAndProximity,
  findClosestService,
} from './servicePreparation.js'
import {
  createNewShiftWithConsistentStartTime,
  countShiftsInWeek,
} from './shiftManagement.js'

export function scheduleService({ service, techSchedules, remainingServices }) {
  // Check if the service has already been scheduled
  for (const techId in techSchedules) {
    for (const shift of techSchedules[techId].shifts) {
      if (shift.services.some(s => s.id === service.id)) {
        return { scheduled: true, reason: 'Service already scheduled', techId }
      }
    }
  }

  // Sort techs by the number of shifts they have, in ascending order
  const sortedTechs = Object.keys(techSchedules).sort(
    (a, b) => techSchedules[a].shifts.length - techSchedules[b].shifts.length,
  )

  for (const techId of sortedTechs) {
    const result = tryScheduleForTech({
      service,
      techId,
      techSchedules,
      remainingServices,
    })

    if (result.scheduled) {
      updateDistanceInfo(techSchedules[techId])
      return { ...result, techId }
    }
  }

  const newTechId = `Tech ${Object.keys(techSchedules).length + 1}`
  techSchedules[newTechId] = { shifts: [] }
  const result = tryScheduleForTech({
    service,
    techId: newTechId,
    techSchedules,
    remainingServices,
  })

  if (result.scheduled) return { ...result, techId: newTechId }

  // If we reach this point, the service couldn't be scheduled
  return {
    scheduled: false,
    reason: "Couldn't be scheduled with any tech or in a new shift",
    techId: null,
  }
}

function tryScheduleForTech({
  service,
  techId,
  techSchedules,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]

  // Try to fit the services into existing shifts
  for (
    let shiftIndex = 0;
    shiftIndex < techSchedule.shifts.length;
    shiftIndex++
  ) {
    const shift = techSchedule.shifts[shiftIndex]
    let scheduledCount = 0
    let lastScheduledService =
      shift.services[shift.services.length - 1] || service

    // First, try to schedule nearby services
    while (true) {
      const closestService = findClosestService(
        lastScheduledService,
        remainingServices,
        10,
      ) // 10 miles max distance
      if (!closestService) break

      const result = tryScheduleInShift({
        service: closestService,
        shift,
        techId,
        remainingServices,
      })

      if (result.scheduled) {
        scheduledCount++
        lastScheduledService = closestService
        const index = remainingServices.findIndex(
          s => s.id === closestService.id,
        )
        if (index !== -1) {
          remainingServices.splice(index, 1)
        }
        closestService.distanceFromPrevious = calcDistance(
          lastScheduledService.location,
          closestService.location,
        )
      } else {
        break
      }
    }

    // Then, fill any remaining gaps with other services
    const sortedRemainingServices = sortServicesByTimeAndProximity(
      remainingServices,
      0.3,
    ) // Prioritize time more than location
    for (const service of sortedRemainingServices) {
      const result = tryScheduleInShift({
        service,
        shift,
        techId,
        remainingServices,
      })

      if (result.scheduled) {
        scheduledCount++
        const index = remainingServices.findIndex(s => s.id === service.id)
        if (index !== -1) {
          remainingServices.splice(index, 1)
        }
        service.distanceFromPrevious = calcDistance(
          lastScheduledService.location,
          service.location,
        )
        lastScheduledService = service
      }

      if (getShiftDuration(shift) >= MAX_SHIFT_HOURS) {
        break
      }
    }

    if (scheduledCount > 0) {
      return {
        scheduled: true,
        reason: `Scheduled ${scheduledCount} services in existing shift for Tech ${techId}`,
      }
    }
  }

  // If we couldn't schedule in existing shifts, try to create a new shift
  if (techSchedule.shifts.length < 5) {
    const newShift = createNewShiftWithConsistentStartTime({
      techSchedule: techSchedule,
      rangeStart: new Date(service.time.range[0]),
      remainingServices,
    })

    const result = tryScheduleInShift({
      service,
      shift: newShift,
      techId,
      remainingServices,
    })

    if (result.scheduled) {
      techSchedule.shifts.push(newShift)
      return {
        scheduled: true,
        reason: `Created new shift for Tech ${techId}`,
      }
    }
  }

  return {
    scheduled: false,
    reason: `Couldn't schedule service for Tech ${techId}`,
  }
}

function getShiftDuration(shift) {
  return (
    (new Date(shift.shiftEnd) - new Date(shift.shiftStart)) / (1000 * 60 * 60)
  )
}

function tryScheduleInShift({ service, shift, techId, remainingServices }) {
  // Check if the service is already in this shift
  if (shift.services.some(s => s.id === service.id)) {
    return { scheduled: false, reason: 'Service already in this shift' }
  }

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
    let endTime = addMinutes(startTime, serviceDuration)

    if (endTime > addHours(shiftStart, MAX_SHIFT_HOURS)) {
      return { scheduled: false }
    }

    if (canScheduleAtTime(shift, startTime, endTime)) {
      const scheduledService = {
        ...service,
        start: startTime,
        end: endTime,
      }

      const insertIndex = findBestInsertionPoint(
        shift.services,
        scheduledService,
      )
      shift.services.splice(insertIndex, 0, scheduledService)

      if (endTime > shiftEnd) {
        shift.shiftEnd = endTime
      }

      // Try to schedule nearby services in the same shift
      scheduleNearbyServices(shift, remainingServices, techId)

      return { scheduled: true }
    }

    startTime = addMinutes(startTime, 15)
  }

  return { scheduled: false }
}

function scheduleNearbyServices(shift, remainingServices, techId) {
  let lastScheduledService = shift.services[shift.services.length - 1]

  // First, schedule nearby services
  while (true) {
    const closestService = findClosestService(
      lastScheduledService,
      remainingServices,
      10,
    ) // 10 miles max distance
    if (!closestService) break

    const result = tryScheduleInShift({
      service: closestService,
      shift,
      techId,
      remainingServices,
    })

    if (result.scheduled) {
      lastScheduledService = closestService
      const index = remainingServices.findIndex(s => s.id === closestService.id)
      if (index !== -1) {
        remainingServices.splice(index, 1)
      }
      closestService.distanceFromPrevious = calcDistance(
        lastScheduledService.location,
        closestService.location,
      )
    } else {
      break
    }
  }

  // Then, fill any remaining gaps with other services
  const sortedRemainingServices = sortServicesByTimeAndProximity(
    remainingServices,
    0.3,
  ) // Prioritize time more than location
  for (const service of sortedRemainingServices) {
    if (getShiftDuration(shift) >= MAX_SHIFT_HOURS) {
      break
    }

    const result = tryScheduleInShift({
      service,
      shift,
      techId,
      remainingServices,
    })

    if (result.scheduled) {
      const index = remainingServices.findIndex(s => s.id === service.id)
      if (index !== -1) {
        remainingServices.splice(index, 1)
      }
      service.distanceFromPrevious = calcDistance(
        lastScheduledService.location,
        service.location,
      )
      lastScheduledService = service
    }
  }
}

function canScheduleAtTime(shift, startTime, endTime) {
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

function updateDistanceInfo(techSchedule) {
  for (const shift of techSchedule.shifts) {
    const services = shift.services
    services.sort((a, b) => new Date(a.start) - new Date(b.start))

    for (let i = 1; i < services.length; i++) {
      const currentService = services[i]
      const previousService = services[i - 1]
      currentService.distanceFromPrevious = calcDistance(
        previousService.location,
        currentService.location,
      )
    }

    if (services.length > 0) {
      services[0].distanceFromPrevious = null
    }
  }
}

export function scheduleEnforcedService({ service, techSchedules }) {
  const techId = service.tech.code
  if (!techSchedules[techId]) {
    techSchedules[techId] = {
      shifts: [],
    }
  }

  const result = tryScheduleForTech({
    service,
    techId,
    techSchedules,
    remainingServices: [],
  })

  if (result.scheduled) {
    updateDistanceInfo(techSchedules[techId])
    return result
  }

  return { scheduled: false, reason: "Couldn't schedule enforced service" }
}
