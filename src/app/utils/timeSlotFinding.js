// /src/app/utils/timeSlotFinding.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

export function findBestTimeSlot(event, existingEvents, [rangeStart, rangeEnd]) {
  const duration = event.time.duration * 60 * 1000 // Convert to milliseconds
  const dayStart = event.start.setHours(0, 0, 0, 0)
  const preferredTime = dayStart + parseTime(event.time.preferred) * 1000

  let bestSlot = null
  let bestDistance = Infinity

  for (
    let slotStart = dayStart + rangeStart * 1000;
    slotStart <= dayStart + rangeEnd * 1000 - duration;
    slotStart += 60000 // Check every minute
  ) {
    const slotEnd = slotStart + duration
    if (
      existingEvents.every((existingEvent) => {
        const existingStart = existingEvent.start.getTime()
        const existingEnd = existingEvent.end.getTime()
        return slotEnd <= existingStart || slotStart >= existingEnd
      })
    ) {
      const distance = Math.abs(slotStart - preferredTime)
      if (distance < bestDistance) {
        bestSlot = { start: slotStart, end: slotEnd }
        bestDistance = distance
      }
    }
  }

  return bestSlot
}

export function findBestTimeSlotBasedOnPreferred(event, allocatedEvents) {
  const preferredTime = parseTime(event.time.preferred)
  const duration = event.time.duration * 60 * 1000 // Convert to milliseconds
  const dayStart = event.start.setHours(0, 0, 0, 0)

  let bestSlot = null
  let bestDistance = Infinity

  for (const resourceId of new Set(allocatedEvents.map((e) => e.resourceId))) {
    const resourceEvents = allocatedEvents.filter((e) => e.resourceId === resourceId)

    // Check slot after the last event for this resource
    const lastEvent = resourceEvents[resourceEvents.length - 1]
    if (lastEvent) {
      const slotStart = lastEvent.end.getTime()
      const slotEnd = slotStart + duration
      const distance = Math.abs(slotStart - (dayStart + preferredTime * 1000))

      if (distance < bestDistance) {
        bestSlot = { start: slotStart, end: slotEnd, resourceId }
        bestDistance = distance
      }
    }

    // Check slots between events
    for (let i = 0; i < resourceEvents.length; i++) {
      const currentEvent = resourceEvents[i]
      const nextEvent = resourceEvents[i + 1]

      if (nextEvent) {
        const slotStart = currentEvent.end.getTime()
        const slotEnd = nextEvent.start.getTime()

        if (slotEnd - slotStart >= duration) {
          const idealStart = Math.max(slotStart, dayStart + preferredTime * 1000)
          const idealEnd = idealStart + duration

          if (idealEnd <= slotEnd) {
            const distance = Math.abs(idealStart - (dayStart + preferredTime * 1000))
            if (distance < bestDistance) {
              bestSlot = { start: idealStart, end: idealEnd, resourceId }
              bestDistance = distance
            }
          }
        }
      }
    }
  }

  return bestSlot
}

export function createAllocatedEvent(event, resourceId, existingEvents) {
  const allocatedEvent = {
    ...event,
    resourceId: resourceId,
  }

  const preferredTime = event.time.preferred
  const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
  const duration = event.time.duration * 60 // Duration in seconds
  const dayStart = new Date(event.start).setHours(0, 0, 0, 0)

  // Convert preferred time to seconds since midnight
  const preferredSeconds = parseTime(preferredTime)

  // Check if the preferred time is outside the original range
  if (preferredSeconds < rangeStart || preferredSeconds > rangeEnd - duration) {
    // Adjust the start time to the preferred time, if possible
    const newStart = Math.min(preferredSeconds, rangeEnd - duration)
    const newEnd = newStart + duration

    allocatedEvent.start = new Date(dayStart + newStart * 1000)
    allocatedEvent.end = new Date(dayStart + newEnd * 1000)

    // Mark this event as changed
    allocatedEvent.changed = true
    allocatedEvent.originalRange = event.time.originalRange
    allocatedEvent.newRange = `${dayjs(allocatedEvent.start).format('h:mma')} - ${dayjs(allocatedEvent.end).format('h:mma')}`
  } else {
    // If the preferred time is within the range, use the original logic
    if (!event.time.enforced) {
      const bestSlot = findBestTimeSlot(
        event,
        existingEvents.filter((e) => e.resourceId === resourceId),
        [rangeStart, rangeEnd],
      )
      if (bestSlot) {
        allocatedEvent.start = new Date(bestSlot.start)
        allocatedEvent.end = new Date(bestSlot.end)
      } else {
        // If no best slot found, use the preferred time
        allocatedEvent.start = new Date(dayStart + preferredSeconds * 1000)
        allocatedEvent.end = new Date(dayStart + (preferredSeconds + duration) * 1000)
      }
    } else {
      // For enforced times, use the preferred time
      allocatedEvent.start = new Date(dayStart + preferredSeconds * 1000)
      allocatedEvent.end = new Date(dayStart + (preferredSeconds + duration) * 1000)
    }
  }

  return allocatedEvent
}

export function canAllocateToResource(newEvent, existingEvents) {
  if (newEvent.time.enforced) {
    // For enforced times, check for direct conflicts
    const newStart = newEvent.start.getTime()
    const newEnd = newEvent.end.getTime()
    const conflictingEvents = existingEvents.filter((existingEvent) => {
      const existingStart = existingEvent.start.getTime()
      const existingEnd = existingEvent.end.getTime()
      return !(newEnd <= existingStart || newStart >= existingEnd)
    })
    return conflictingEvents.length === 0 ? true : conflictingEvents
  } else {
    // For non-enforced times, check if there's any available slot within the range
    const [rangeStart, rangeEnd] = parseTimeRange(
      newEvent.time.originalRange,
      newEvent.time.duration,
    )
    const duration = newEvent.time.duration * 60 * 1000 // Convert to milliseconds
    const dayStart = newEvent.start.setHours(0, 0, 0, 0)

    for (
      let slotStart = dayStart + rangeStart * 1000;
      slotStart <= dayStart + rangeEnd * 1000 - duration;
      slotStart += 60000
    ) {
      const slotEnd = slotStart + duration
      if (
        existingEvents.every((existingEvent) => {
          const existingStart = existingEvent.start.getTime()
          const existingEnd = existingEvent.end.getTime()
          return slotEnd <= existingStart || slotStart >= existingEnd
        })
      ) {
        return true
      }
    }

    return false
  }
}
