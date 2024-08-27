// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTimeRange } from './timeRange'

export function scheduleEvents(events, resources, enforceTechs) {
  const scheduledEvents = []
  const unscheduledEvents = []

  // Sort events by start time of their range
  events.sort((a, b) => {
    const [aStart] = parseTimeRange(a.time.originalRange, a.time.duration)
    const [bStart] = parseTimeRange(b.time.originalRange, b.time.duration)
    return aStart - bStart
  })

  events.forEach((event) => {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    let scheduled = false

    if (enforceTechs) {
      const techResource = resources.find((r) => r.id === event.tech.code)
      if (techResource) {
        const slot = findAvailableSlot(
          scheduledEvents,
          event,
          rangeStart,
          rangeEnd,
          techResource.id,
        )
        if (slot) {
          scheduledEvents.push(createScheduledEvent(event, slot, techResource.id))
          scheduled = true
        }
      }
    } else {
      for (const resource of resources) {
        const slot = findAvailableSlot(scheduledEvents, event, rangeStart, rangeEnd, resource.id)
        if (slot) {
          scheduledEvents.push(createScheduledEvent(event, slot, resource.id))
          scheduled = true
          break
        }
      }
    }

    if (!scheduled) {
      unscheduledEvents.push(event)
    }
  })

  return { scheduledEvents, unscheduledEvents }
}

function findAvailableSlot(scheduledEvents, event, rangeStart, rangeEnd, resourceId) {
  const eventDate = dayjs(event.start)
  const dayStart = eventDate.startOf('day')
  const existingEvents = scheduledEvents.filter(
    (e) => e.resourceId === resourceId && dayjs(e.start).isSame(eventDate, 'day'),
  )

  let currentTime = dayStart.add(rangeStart, 'second')
  const endTime = dayStart.add(rangeEnd, 'second')

  while (currentTime.isBefore(endTime)) {
    const potentialEnd = currentTime.add(event.time.duration, 'minute')

    const conflict = existingEvents.some((existingEvent) => {
      const existingStart = dayjs(existingEvent.start)
      const existingEnd = dayjs(existingEvent.end)
      return currentTime.isBefore(existingEnd) && potentialEnd.isAfter(existingStart)
    })

    if (!conflict) {
      return { start: currentTime, end: potentialEnd }
    }

    currentTime = currentTime.add(15, 'minute') // Move to next 15-minute slot
  }

  return null
}

function createScheduledEvent(event, slot, resourceId) {
  return {
    ...event,
    start: slot.start.toDate(),
    end: slot.end.toDate(),
    resourceId: resourceId,
  }
}
