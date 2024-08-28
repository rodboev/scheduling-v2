// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let scheduledEvents = []
  let unscheduledEvents = []
  let allConflicts = []
  let unscheduledDueToCompaction = []

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

  // Keep track of work time for each resource
  const resourceWorkTime = {}

  visibleEvents.forEach((event) => {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    let scheduled = false
    let conflictingEvents = []
    let exceedsWorkHours = false

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
        }
      }
    } else if (enforceTechs) {
      const techResource = resources.find((r) => r.id === event.tech.code)
      if (techResource) {
        const {
          slot,
          conflicts,
          exceedsWorkHours: resourceExceedsWorkHours,
        } = findEarliestAvailableSlot(
          scheduledEvents,
          event,
          rangeStart,
          rangeEnd,
          techResource.id,
          resourceWorkTime[techResource.id],
        )
        if (slot && !resourceExceedsWorkHours) {
          scheduledEvents.push(createScheduledEvent(event, slot, techResource.id))
          scheduled = true
        } else {
          conflictingEvents = conflicts
          exceedsWorkHours = resourceExceedsWorkHours
        }
      }
    } else {
      for (const resource of resources) {
        const {
          slot,
          conflicts,
          exceedsWorkHours: resourceExceedsWorkHours,
        } = findEarliestAvailableSlot(
          scheduledEvents,
          event,
          rangeStart,
          rangeEnd,
          resource.id,
          resourceWorkTime[resource.id],
        )
        if (slot && !resourceExceedsWorkHours) {
          const scheduledEvent = createScheduledEvent(event, slot, resource.id)
          scheduledEvents.push(scheduledEvent)

          // Update resource work time
          if (!resourceWorkTime[resource.id]) {
            resourceWorkTime[resource.id] = { start: slot.start, end: slot.end }
          } else {
            resourceWorkTime[resource.id].start = dayjs.min(
              resourceWorkTime[resource.id].start,
              slot.start,
            )
            resourceWorkTime[resource.id].end = dayjs.max(
              resourceWorkTime[resource.id].end,
              slot.end,
            )
          }

          scheduled = true
          break
        } else {
          conflictingEvents = conflicts
          exceedsWorkHours = resourceExceedsWorkHours
        }
      }
    }

    if (!scheduled) {
      let reason
      if (exceedsWorkHours) {
        reason = "No available slot within the tech's 8-hour work limit"
      } else if (conflictingEvents.length > 0) {
        const conflictingTitles = conflictingEvents.map((e) => e.title).join(', ')
        reason = `Couldn't schedule because of conflict with ${conflictingTitles}`
      } else {
        reason = "No available slot within the event's time range"
      }

      unscheduledEvents.push({ ...event, reason })
      allConflicts.push({
        event,
        conflicts: conflictingEvents,
        reason,
      })
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

    unscheduledDueToCompaction = unscheduledDueToCompaction.concat(
      unscheduled.map((event) => ({
        ...event,
        reason: 'Unscheduled due to compaction',
      })),
    )
  })

  // Add unscheduled events due to compaction to the main unscheduled events list
  unscheduledEvents = unscheduledEvents.concat(unscheduledDueToCompaction)

  // Replace non-enforced scheduled events with compacted events
  scheduledEvents = scheduledEvents.filter((event) => event.tech.enforced).concat(compactedEvents)

  console.log(`Total scheduled events after compaction: ${scheduledEvents.length}`)
  console.log(`Total unscheduled events: ${unscheduledEvents.length}`)
  console.log(`Total conflicts: ${allConflicts.length}`)
  console.log(`Unscheduled due to compaction: ${unscheduledDueToCompaction.length}`)

  return {
    scheduledEvents,
    unscheduledEvents,
    conflicts: allConflicts,
    unscheduledDueToCompaction,
  }
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

function findEarliestAvailableSlot(
  scheduledEvents,
  event,
  rangeStart,
  rangeEnd,
  resourceId,
  resourceWorkTime,
) {
  const eventDate = dayjs(event.start)
  const dayStart = eventDate.startOf('day')

  let currentTime = dayStart.add(rangeStart, 'second')
  const endTime = dayjs.min(dayStart.add(rangeEnd, 'second'), dayStart.add(1, 'day'))
  let exceedsWorkHours = false
  let conflicts = []

  while (currentTime.isBefore(endTime)) {
    const potentialEnd = currentTime.add(event.time.duration, 'minute')

    const { conflicts: currentConflicts } = findConflicts(
      scheduledEvents,
      currentTime,
      potentialEnd,
      resourceId,
    )

    if (currentConflicts.length === 0) {
      // Check if this slot would exceed the 8-hour work limit
      if (resourceWorkTime) {
        const workStart = dayjs.min(resourceWorkTime.start, currentTime)
        const workEnd = dayjs.max(resourceWorkTime.end, potentialEnd)
        const workDuration = workEnd.diff(workStart, 'second')
        if (workDuration > MAX_WORK_HOURS) {
          exceedsWorkHours = true
          break
        }
      }
      return {
        slot: { start: currentTime, end: potentialEnd },
        conflicts: [],
        exceedsWorkHours: false,
      }
    }

    conflicts = currentConflicts
    currentTime = currentTime.add(1, 'minute') // Move to next minute
  }

  return {
    slot: null,
    conflicts,
    exceedsWorkHours,
  }
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
