// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

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
    let conflictingEvents = []

    if (enforceTechs) {
      const techResource = resources.find((r) => r.id === event.tech.code)
      if (techResource) {
        const { slot, conflicts } = findEarliestAvailableSlot(
          scheduledEvents,
          event,
          rangeStart,
          rangeEnd,
          techResource.id,
        )
        if (slot) {
          scheduledEvents.push(createScheduledEvent(event, slot, techResource.id))
          scheduled = true
        } else {
          conflictingEvents = conflicts
        }
      }
    } else {
      for (const resource of resources) {
        const { slot, conflicts } = findEarliestAvailableSlot(
          scheduledEvents,
          event,
          rangeStart,
          rangeEnd,
          resource.id,
        )
        if (slot) {
          scheduledEvents.push(createScheduledEvent(event, slot, resource.id))
          scheduled = true
          break
        } else {
          conflictingEvents = conflicts
        }
      }
    }

    if (!scheduled) {
      unscheduledEvents.push({
        ...event,
        reason:
          conflictingEvents.length > 0
            ? `Conflicts with: ${conflictingEvents.map((e) => e.title).join(', ')}`
            : "No available slot within the event's time range",
      })
    }
  })

  // After scheduling, apply compaction
  resources.forEach((resource) => {
    const resourceEvents = scheduledEvents.filter((event) => event.resourceId === resource.id)
    console.log(`Compacting events for ${resource.id}, ${resourceEvents.length} events`)
    compactEvents(resourceEvents)
  })
  console.log(`Total scheduled events after compaction: ${scheduledEvents.length}`)

  return { scheduledEvents, unscheduledEvents }
}

function findEarliestAvailableSlot(scheduledEvents, event, rangeStart, rangeEnd, resourceId) {
  const eventDate = dayjs(event.start)
  const dayStart = eventDate.startOf('day')
  const existingEvents = scheduledEvents.filter(
    (e) => e.resourceId === resourceId && dayjs(e.start).isSame(eventDate, 'day'),
  )

  let currentTime = dayStart.add(rangeStart, 'second')
  const endTime = dayStart.add(rangeEnd, 'second')
  let conflicts = []

  while (currentTime.isBefore(endTime)) {
    const potentialEnd = currentTime.add(event.time.duration, 'minute')

    conflicts = existingEvents.filter((existingEvent) => {
      const existingStart = dayjs(existingEvent.start)
      const existingEnd = dayjs(existingEvent.end)
      return currentTime.isBefore(existingEnd) && potentialEnd.isAfter(existingStart)
    })

    if (conflicts.length === 0) {
      return { slot: { start: currentTime, end: potentialEnd }, conflicts: [] }
    }

    currentTime = currentTime.add(1, 'minute') // Move to next minute
  }

  return { slot: null, conflicts }
}

function createScheduledEvent(event, slot, resourceId) {
  return {
    ...event,
    start: slot.start.toDate(),
    end: slot.end.toDate(),
    resourceId: resourceId,
  }
}

function compactEvents(events) {
  console.log(`Compacting ${events.length} events`)
  events.sort((a, b) => a.start - b.start)

  for (let i = 0; i < events.length; i++) {
    const currentEvent = events[i]
    const [rangeStart, rangeEnd] = parseTimeRange(
      currentEvent.time.originalRange,
      currentEvent.time.duration,
    )
    const preferredTime = parseTime(currentEvent.time.preferred)
    const currentEventDayStart = dayjs(currentEvent.start).startOf('day')

    // Calculate the earliest possible start time
    let earliestPossibleStart
    if (i === 0) {
      earliestPossibleStart = currentEventDayStart.add(rangeStart, 'second')
    } else {
      const previousEvent = events[i - 1]
      earliestPossibleStart = dayjs(previousEvent.end)
    }

    // Calculate the latest possible end time
    const latestPossibleEnd = currentEventDayStart.add(rangeEnd, 'second')

    // Try to move the event as close to the preferred time as possible
    let newStart = dayjs.max(
      earliestPossibleStart,
      currentEventDayStart.add(preferredTime, 'second'),
    )

    // If the new start time exceeds the range end, set it to the earliest possible start
    if (newStart.isAfter(latestPossibleEnd.subtract(currentEvent.time.duration, 'minute'))) {
      newStart = earliestPossibleStart
    }

    const newEnd = newStart.add(currentEvent.time.duration, 'minute')

    // Ensure the new end time doesn't exceed the event's allowed range and doesn't overlap with the next event
    if (newEnd.isBefore(latestPossibleEnd) || newEnd.isSame(latestPossibleEnd)) {
      if (i === events.length - 1 || newEnd.isBefore(dayjs(events[i + 1].start))) {
        if (!dayjs(currentEvent.start).isSame(newStart)) {
          console.log(
            `Moving event ${currentEvent.title} from ${dayjs(currentEvent.start).format('HH:mm')} to ${newStart.format('HH:mm')}`,
          )
          currentEvent.start = newStart.toDate()
          currentEvent.end = newEnd.toDate()
        }
      }
    }
  }

  // Second pass: Try to move events later if there's space
  for (let i = events.length - 1; i >= 0; i--) {
    const currentEvent = events[i]
    const [rangeStart, rangeEnd] = parseTimeRange(
      currentEvent.time.originalRange,
      currentEvent.time.duration,
    )
    const currentEventDayStart = dayjs(currentEvent.start).startOf('day')

    // Calculate the latest possible end time
    const latestPossibleEnd = currentEventDayStart.add(rangeEnd, 'second')

    // Calculate the latest start time that doesn't overlap with the next event
    let latestStartTime
    if (i === events.length - 1) {
      latestStartTime = latestPossibleEnd.subtract(currentEvent.time.duration, 'minute')
    } else {
      const nextEvent = events[i + 1]
      latestStartTime = dayjs.min(
        latestPossibleEnd.subtract(currentEvent.time.duration, 'minute'),
        dayjs(nextEvent.start).subtract(currentEvent.time.duration, 'minute'),
      )
    }

    // Try to move the event later if possible
    if (latestStartTime.isAfter(dayjs(currentEvent.start))) {
      const newStart = latestStartTime
      const newEnd = newStart.add(currentEvent.time.duration, 'minute')

      console.log(
        `Moving event ${currentEvent.title} later from ${dayjs(currentEvent.start).format('HH:mm')} to ${newStart.format('HH:mm')}`,
      )
      currentEvent.start = newStart.toDate()
      currentEvent.end = newEnd.toDate()
    }
  }
}
