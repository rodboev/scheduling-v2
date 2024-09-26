import axios from 'axios'
import { addHours, addMinutes, max, min } from '../utils/dateHelpers.js'
import { MIN_REST_HOURS, MAX_SHIFT_GAP, MAX_SHIFT_HOURS } from './index.js'

export function compactShift(shift) {
  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

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
  return Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.shifts.flatMap(shift =>
      shift.services.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: techId,
        distanceFromPrevious: service.distanceFromPrevious,
        previousCompany: service.previousCompany,
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

export function countShiftsInWeek(techSchedule, weekStart) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  return techSchedule.shifts.filter(shift => {
    const shiftStart = new Date(shift.shiftStart)
    return shiftStart >= weekStart && shiftStart < weekEnd
  }).length
}

export async function calculateDistances(services) {
  const distanceMap = new Map()

  for (let i = 0; i < services.length; i++) {
    const service = services[i]
    const nearbyServices = await fetchNearbyServices(service.location.id)
    distanceMap.set(service.location.id.toString(), nearbyServices)

    // Log progress
    if (i % 100 === 0) {
      console.log(
        `Calculated distances for ${i} out of ${services.length} services`,
      )
    }
  }

  console.log('Distance calculation completed')
  return distanceMap
}

async function fetchNearbyServices(locationId) {
  try {
    const response = await axios.get(
      `http://localhost:${process.env.PORT}/api/distance?id=${locationId}&limit=500`,
    )
    return response.data.distance || []
  } catch (error) {
    console.error('Error fetching nearby services:', error)
    return []
  }
}
