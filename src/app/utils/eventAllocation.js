// /src/app/utils/eventAllocation.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTime, parseTimeRange } from '@/app/utils/timeRange'
import { findBestTimeSlot } from '@/app/utils/timeSlotFinding'

export function allocateEventsToResources(events, enforceTechs) {
  const techResources = new Map()
  const genericResources = []
  let genericResourceCount = 0

  events.sort((a, b) => {
    if (a.tech.enforced && !b.tech.enforced) return -1
    if (!a.tech.enforced && b.tech.enforced) return 1
    if (a.time.enforced && !b.time.enforced) return -1
    if (!a.time.enforced && b.time.enforced) return 1
    return a.time.preferred - b.time.preferred
  })

  const allocatedEvents = []
  const unallocatedEvents = []
  const changedEvents = []
  const scheduleSummary = {}

  for (const event of events) {
    let allocated = false
    let changed = false

    // Handle null range
    if (!event.time.range[0] || !event.time.range[1]) {
      event.time.range = [event.time.preferred, event.time.preferred + event.time.duration * 60]
      changed = true
    }

    if (enforceTechs || event.tech.enforced) {
      // Use the specific tech
      const techId = event.tech.code
      if (!techResources.has(techId)) {
        techResources.set(techId, { id: techId, title: event.tech.code })
      }
      const canAllocate = canAllocateToResource(
        event,
        allocatedEvents.filter((e) => e.resourceId === techId),
      )
      if (canAllocate === true) {
        const allocatedEvent = createAllocatedEvent(event, techId, allocatedEvents)
        allocatedEvents.push(allocatedEvent)
        allocated = true
        addToScheduleSummary(scheduleSummary, allocatedEvent)
      }
    } else {
      // For non-enforced techs, try generic resources
      for (let i = 0; i < genericResourceCount + 1; i++) {
        const resourceId = `Tech ${i + 1}`
        const canAllocate = canAllocateToResource(
          event,
          allocatedEvents.filter((e) => e.resourceId === resourceId),
        )
        if (canAllocate === true) {
          if (i === genericResourceCount) {
            genericResources.push({ id: resourceId, title: resourceId })
            genericResourceCount++
          }
          const allocatedEvent = createAllocatedEvent(event, resourceId, allocatedEvents)
          allocatedEvents.push(allocatedEvent)
          allocated = true
          addToScheduleSummary(scheduleSummary, allocatedEvent)
          break
        }
      }
    }

    if (!allocated) {
      // Try to find a suitable slot based on preferred time
      const bestSlot = findBestTimeSlotBasedOnPreferred(event, allocatedEvents)
      if (bestSlot) {
        const resourceId = bestSlot.resourceId
        const allocatedEvent = createAllocatedEvent(event, resourceId, allocatedEvents)
        allocatedEvent.start = new Date(bestSlot.start)
        allocatedEvent.end = new Date(bestSlot.end)
        allocatedEvents.push(allocatedEvent)
        allocated = true
        changed = true
        addToScheduleSummary(scheduleSummary, allocatedEvent)
      }
    }

    if (allocated) {
      const lastAllocatedEvent = allocatedEvents[allocatedEvents.length - 1]
      if (lastAllocatedEvent.changed) {
        changedEvents.push({
          event: lastAllocatedEvent,
          reason: 'Range adjusted to match preferred time',
          originalRange: lastAllocatedEvent.originalRange,
          newRange: lastAllocatedEvent.newRange,
        })
      } else if (changed) {
        changedEvents.push({
          event: lastAllocatedEvent,
          reason: 'Range adjusted to fit schedule',
          originalRange: event.time.originalRange,
          newRange: `${dayjs(lastAllocatedEvent.start).format('h:mma')} - ${dayjs(lastAllocatedEvent.end).format('h:mma')}`,
        })
      }
    }

    if (!allocated) {
      unallocatedEvents.push({
        event,
        reason: 'No available time slot found for any resource',
        conflictingEvents: findConflictingEvents(event, allocatedEvents),
      })
    }
  }

  console.log('Allocated events:', allocatedEvents.length)
  console.log('Unallocated events:', unallocatedEvents.length)
  console.log('Changed events:', changedEvents.length)

  const resources = [...techResources.values(), ...genericResources]
  return { allocatedEvents, resources, unallocatedEvents, changedEvents, scheduleSummary }
}

function addToScheduleSummary(scheduleSummary, event) {
  const resourceName = event.resourceId
  const startTime = dayjs(event.start).format('h:mma')
  const endTime = dayjs(event.end).format('h:mma')

  if (!scheduleSummary[resourceName]) {
    scheduleSummary[resourceName] = []
  }

  scheduleSummary[resourceName].push(`${event.title} is at ${startTime}-${endTime}`)
}

function createAllocatedEvent(event, resourceId, existingEvents) {
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

function canAllocateToResource(newEvent, existingEvents) {
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
    const [rangeStart, rangeEnd] = newEvent.time.range
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

    // If no slot found, try to adjust the range
    const lastExistingEvent = existingEvents[existingEvents.length - 1]
    if (lastExistingEvent) {
      const newStart = Math.max(lastExistingEvent.end.getTime(), dayStart + rangeStart * 1000)
      const newEnd = newStart + duration
      if (newEnd <= dayStart + 24 * 60 * 60 * 1000) {
        // Ensure it's still within the day
        newEvent.start = new Date(newStart)
        newEvent.end = new Date(newEnd)
        newEvent.time.range = [(newStart - dayStart) / 1000, (newEnd - dayStart) / 1000]
        return true
      }
    }

    return false
  }
}

function findBestTimeSlotBasedOnPreferred(event, allocatedEvents) {
  const preferredTime = event.time.preferred
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

function findConflictingEvents(event, allocatedEvents) {
  return allocatedEvents.filter((allocatedEvent) => {
    const eventStart = event.start.getTime()
    const eventEnd = eventStart + event.time.duration * 60 * 1000
    const allocatedStart = allocatedEvent.start.getTime()
    const allocatedEnd = allocatedEvent.end.getTime()
    return eventStart < allocatedEnd && eventEnd > allocatedStart
  })
}
