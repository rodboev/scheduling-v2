// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'
export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let scheduledEvents = []
  let unscheduledEvents = []
  let allConflicts = []

  console.log(`Total events to schedule: ${events.length}`)
  console.log(`Resources available: ${resources.length}`)
  console.log(`Enforce techs: ${enforceTechs}`)

  // Filter events to only those within the visible range
  const visibleEvents = events.filter(
    (event) =>
      dayjs(event.start).isBetween(visibleStart, visibleEnd, null, '[]') ||
      dayjs(event.end).isBetween(visibleStart, visibleEnd, null, '[]'),
  )

  // Sort events by start time of their range
  visibleEvents.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  visibleEvents.forEach((event) => {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    let scheduled = false
    let conflictingEvents = []

    if (event.tech.enforced) {
      // For enforced techs, schedule at the preferred time without optimization
      const techResource = resources.find((r) => r.id === event.tech.code)
      if (techResource) {
        const preferredTime = parseTime(event.time.preferred)
        const preferredStart = dayjs(event.start).startOf('day').add(preferredTime, 'second')
        const preferredEnd = preferredStart.add(event.time.duration, 'minute')

        const { conflicts } = findConflicts(
          scheduledEvents,
          preferredStart,
          preferredEnd,
          techResource.id,
        )

        if (conflicts.length === 0) {
          scheduledEvents.push(
            createScheduledEvent(
              event,
              { start: preferredStart, end: preferredEnd },
              techResource.id,
            ),
          )
          scheduled = true
        } else {
          conflictingEvents = conflicts
          allConflicts.push({ event, conflicts })
        }
      }
    } else if (enforceTechs) {
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
          allConflicts.push({ event, conflicts })
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
      if (!scheduled) {
        allConflicts.push({ event, conflicts: conflictingEvents })
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
      allConflicts.push({ event, conflicts: conflictingEvents })
    }
  })

  // After scheduling, apply compaction only to non-enforced events
  let compactedEvents = []
  resources.forEach((resource) => {
    const resourceEvents = scheduledEvents.filter(
      (event) => event.resourceId === resource.id && !event.tech.enforced,
    )
    console.log(`Compacting events for ${resource.id}, ${resourceEvents.length} events`)
    const { compacted, unscheduled } = compactEvents(resourceEvents)
    compactedEvents = compactedEvents.concat(compacted)
    unscheduledEvents = unscheduledEvents.concat(
      unscheduled.map((event) => ({
        ...event,
        reason: 'Unscheduled due to compaction',
      })),
    )
    allConflicts = allConflicts.concat(
      unscheduled.map((event) => ({
        event,
        conflicts: [{ title: 'Unscheduled due to compaction' }],
      })),
    )
  })

  // Replace non-enforced scheduled events with compacted events
  scheduledEvents = scheduledEvents.filter((event) => event.tech.enforced).concat(compactedEvents)

  console.log(`Total scheduled events after compaction: ${scheduledEvents.length}`)
  console.log(`Total unscheduled events: ${unscheduledEvents.length}`)
  console.log(`Total conflicts: ${allConflicts.length}`)

  return { scheduledEvents, unscheduledEvents, conflicts: allConflicts }
}

function findConflicts(scheduledEvents, start, end, resourceId) {
  const conflicts = scheduledEvents.filter((existingEvent) => {
    return (
      existingEvent.resourceId === resourceId &&
      ((start.isBefore(dayjs(existingEvent.end)) && end.isAfter(dayjs(existingEvent.start))) ||
        start.isSame(dayjs(existingEvent.start)))
    )
  })
  return { conflicts }
}

function createScheduledEvent(event, slot, resourceId) {
  const startTime = dayjs(slot.start)
  const endTime = startTime.add(event.time.duration, 'minute')
  console.log(`createScheduledEvent`, startTime, endTime)
  return {
    ...event,
    start: startTime.toDate(),
    end: endTime.toDate(),
    resourceId: resourceId,
  }
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

function compactEvents(events) {
  console.log(`Compacting ${events.length} events`)
  events.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  let compacted = []
  let unscheduled = []

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
      const previousEvent = compacted[compacted.length - 1]
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

    // If the event can't be scheduled within its allowed range, add it to unscheduled
    if (newEnd.isAfter(latestPossibleEnd)) {
      unscheduled.push(currentEvent)
    } else {
      compacted.push({
        ...currentEvent,
        start: newStart.toDate(),
        end: newEnd.toDate(),
      })
    }
  }

  return { compacted, unscheduled }
}
