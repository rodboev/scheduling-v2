import axios from 'axios'
import { addMinutes, addHours, max, min } from '../utils/dateHelpers.js'
import { MAX_SHIFT_HOURS, MIN_REST_HOURS } from './index.js'
import {
  createNewShiftWithConsistentStartTime,
  countShiftsInWeek,
} from './shifts.js'

// Add this at the top of the file
const distanceCache = new Map()
const SKIP_TRAVEL_TIME = true // Toggle this to true to skip travel time calculations

export async function scheduleService({
  service,
  techSchedules,
  remainingServices,
  distanceMap,
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
      distanceMap,
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
    distanceMap,
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
  distanceMap,
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
      distanceMap,
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
      distanceMap,
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

async function tryScheduleInShift({ service, shift, techId, distanceMap }) {
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

    if (endTime > addHours(shiftStart, MAX_SHIFT_HOURS))
      return { scheduled: false }

    if (
      await canScheduleAtTime(shift, startTime, endTime, service, distanceMap)
    ) {
      const scheduledService = {
        ...service,
        start: startTime,
        end: endTime,
      }

      // Find the best position to insert the new service
      const bestPosition = await findBestPosition(
        shift,
        scheduledService,
        distanceMap,
      )

      // Insert the service at the best position
      shift.services.splice(bestPosition, 0, scheduledService)

      // Update distances and previous companies for all services in the shift
      await updateShiftDistances(shift, distanceMap)

      if (endTime > shiftEnd) shift.shiftEnd = endTime

      return { scheduled: true }
    }

    startTime = addMinutes(startTime, 15)
  }

  return { scheduled: false }
}

async function findBestPosition(shift, newService, distanceMap) {
  if (shift.services.length === 0) return 0

  let bestPosition = 0
  let minTotalDistance = Infinity

  for (let i = 0; i <= shift.services.length; i++) {
    let totalDistance = 0

    if (i > 0) {
      totalDistance += await calculateTravelDistance(
        shift.services[i - 1],
        newService,
        distanceMap,
      )
    }

    if (i < shift.services.length) {
      totalDistance += await calculateTravelDistance(
        newService,
        shift.services[i],
        distanceMap,
      )
    }

    if (totalDistance < minTotalDistance) {
      minTotalDistance = totalDistance
      bestPosition = i
    }
  }

  return bestPosition
}

async function updateShiftDistances(shift) {
  // Sort services by start time
  shift.services.sort((a, b) => new Date(a.start) - new Date(b.start))

  for (let i = 1; i < shift.services.length; i++) {
    const previousService = shift.services[i - 1]
    const currentService = shift.services[i]

    currentService.distanceFromPrevious = await calculateTravelDistance(
      previousService,
      currentService,
    )
    currentService.previousCompany = previousService.company
  }

  // Clear distance and previous company for the first service in the shift
  if (shift.services.length > 0) {
    shift.services[0].distanceFromPrevious = undefined
    shift.services[0].previousCompany = undefined
  }
}

async function calculateTravelDistance(fromService, toService) {
  const fromId = fromService.location.id.toString()
  const toId = toService.location.id.toString()

  // Create a unique key for the pair of locations
  const cacheKey = [fromId, toId].sort().join(',')

  // Check if the distance is already in the cache
  if (distanceCache.has(cacheKey)) {
    return distanceCache.get(cacheKey)
  }

  try {
    const response = await axios.get(
      `http://localhost:${process.env.PORT}/api/distance?id=${cacheKey}`,
    )

    if (
      response.data &&
      response.data.distance &&
      response.data.distance.length > 0
    ) {
      const distance = response.data.distance[0].distance
      // Store the result in the cache
      distanceCache.set(cacheKey, distance)
      return distance
    } else {
      console.warn(`No distance information found for ${fromId} to ${toId}`)
      distanceCache.set(cacheKey, null)
      return null
    }
  } catch (error) {
    console.error(`Error fetching distance for ${fromId} to ${toId}:`, error)
    distanceCache.set(cacheKey, null)
    return null
  }
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

  // Check if there's enough time to travel from the previous service
  if (shift.services.length > 0 && !SKIP_TRAVEL_TIME) {
    const previousService = shift.services[shift.services.length - 1]
    const travelTime = await calculateTravelTime(previousService, service)
    const availableTime = startTime - new Date(previousService.end)

    if (availableTime < travelTime) {
      return false
    }
  }

  return true
}

async function calculateTravelTime(fromService, toService) {
  if (SKIP_TRAVEL_TIME) {
    return 0 // Return 0 travel time when SKIP_TRAVEL_TIME is true
  }

  const distance = await calculateTravelDistance(fromService, toService)

  if (distance === null) {
    // If we don't have distance information, assume a default travel time
    return 30 * 60 * 1000 // 30 minutes in milliseconds
  }

  // Assume an average speed of 30 mph
  const travelTimeHours = distance / 30
  return travelTimeHours * 60 * 60 * 1000 // Convert hours to milliseconds
}

export async function scheduleEnforcedService({
  service,
  techSchedules,
  distanceMap,
}) {
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
  const bestPosition = await findBestPosition(
    targetShift,
    scheduledService,
    distanceMap,
  )

  // Insert the service at the best position
  targetShift.services.splice(bestPosition, 0, scheduledService)

  // Update distances and previous companies for all services in the shift
  await updateShiftDistances(targetShift, distanceMap)

  return { scheduled: true }
}
