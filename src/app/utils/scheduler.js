// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60

function scheduleEvent(
  event,
  resources,
  scheduledEvents,
  rangeStart,
  rangeEnd,
  resourceWorkTime,
  strategy,
) {
  const techResource =
    strategy === 'enforced' || strategy === 'enforcedNonEnforced'
      ? resources.find((r) => r.id === event.tech.code)
      : null

  if (strategy === 'enforced') {
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
      return {
        scheduled: true,
        scheduledEvent: createEvent(
          event,
          { start: preferredStart, end: preferredEnd },
          techResource.id,
        ),
      }
    }

    return { scheduled: false, conflicts }
  }

  if (strategy === 'enforcedNonEnforced' && !techResource) {
    return { scheduled: false, conflicts: [], exceedsWorkHours: false }
  }

  const resourcesToCheck = strategy === 'nonEnforced' ? resources : [techResource]

  for (const resource of resourcesToCheck) {
    const { slot, conflicts, exceedsWorkHours } = findSlot(
      scheduledEvents,
      event,
      rangeStart,
      rangeEnd,
      resource.id,
      resourceWorkTime[resource.id],
    )

    if (slot && !exceedsWorkHours) {
      const scheduledEvent = createEvent(event, slot, resource.id)
      const updatedResourceWorkTime = updateWorkTime(resourceWorkTime, resource.id, slot)
      return { scheduled: true, scheduledEvent, resourceWorkTime: updatedResourceWorkTime }
    }

    if (strategy === 'enforcedNonEnforced') {
      return { scheduled: false, conflicts, exceedsWorkHours }
    }
  }

  return { scheduled: false, conflicts: [], exceedsWorkHours: false }
}

function findSlot(scheduledEvents, event, rangeStart, rangeEnd, resourceId, resourceWorkTime) {
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
    currentTime = currentTime.add(1, 'minute')
  }

  return {
    slot: null,
    conflicts,
    exceedsWorkHours,
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

function createEvent(event, slot, resourceId) {
  const startTime = dayjs(slot.start)
  const endTime = startTime.add(event.time.duration, 'minute')
  return {
    ...event,
    start: startTime.toDate(),
    end: endTime.toDate(),
    resourceId: resourceId,
  }
}

function updateWorkTime(resourceWorkTime, resourceId, slot) {
  if (!resourceWorkTime[resourceId]) {
    return { ...resourceWorkTime, [resourceId]: { start: slot.start, end: slot.end } }
  }
  return {
    ...resourceWorkTime,
    [resourceId]: {
      start: dayjs.min(resourceWorkTime[resourceId].start, slot.start),
      end: dayjs.max(resourceWorkTime[resourceId].end, slot.end),
    },
  }
}

function compactEvents(events) {
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

    const earliestStart = getEarliestStart(i, currentEventDayStart, rangeStart, compacted)
    const latestEnd = currentEventDayStart.add(rangeEnd, 'second')

    const newStart = getNewStart(
      earliestStart,
      currentEventDayStart,
      preferredTime,
      latestEnd,
      currentEvent.time.duration,
    )
    const newEnd = newStart.add(currentEvent.time.duration, 'minute')

    if (newEnd.isAfter(latestEnd)) {
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

function getEarliestStart(index, currentEventDayStart, rangeStart, compacted) {
  if (index === 0) {
    return currentEventDayStart.add(rangeStart, 'second')
  }
  return dayjs(compacted[compacted.length - 1].end)
}

function getNewStart(earliestStart, currentEventDayStart, preferredTime, latestEnd, duration) {
  let newStart = dayjs.max(earliestStart, currentEventDayStart.add(preferredTime, 'second'))

  if (newStart.isAfter(latestEnd.subtract(duration, 'minute'))) {
    newStart = earliestStart
  }

  return newStart
}

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let scheduledEvents = []
  let unscheduledEvents = []
  let allConflicts = []
  let unscheduledDueToCompaction = []
  let resourceWorkTime = {}

  console.log(`Total events to schedule: ${events.length}`)
  console.log(`Resources available: ${resources.length}`)
  console.log(`Enforce techs: ${enforceTechs}`)

  const visibleEvents = events.filter(
    (event) =>
      dayjs(event.start).isBetween(visibleStart, visibleEnd, null, '[]') ||
      dayjs(event.end).isBetween(visibleStart, visibleEnd, null, '[]'),
  )

  visibleEvents.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  visibleEvents.forEach((event) => {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    const strategy = event.tech.enforced
      ? 'enforced'
      : enforceTechs
        ? 'enforcedNonEnforced'
        : 'nonEnforced'

    const result = scheduleEvent(
      event,
      resources,
      scheduledEvents,
      rangeStart,
      rangeEnd,
      resourceWorkTime,
      strategy,
    )

    if (result.scheduled) {
      scheduledEvents.push(result.scheduledEvent)
      if (result.resourceWorkTime) {
        resourceWorkTime = { ...resourceWorkTime, ...result.resourceWorkTime }
      }
    } else {
      unscheduledEvents.push({
        ...event,
        reason: result.exceedsWorkHours
          ? "No available slot within the tech's 8-hour work limit"
          : result.conflicts.length > 0
            ? `Couldn't schedule because of conflict with ${result.conflicts.map((e) => e.title).join(', ')}`
            : "No available slot within the event's time range",
      })
      allConflicts.push({
        event,
        conflicts: result.conflicts,
        reason: result.exceedsWorkHours ? 'Exceeds work hours' : 'Scheduling conflict',
      })
    }
  })

  // Compact non-enforced events
  const nonEnforcedEvents = scheduledEvents.filter((event) => !event.tech.enforced)
  const { compacted, unscheduled } = compactEvents(nonEnforcedEvents)

  // Update scheduled events
  scheduledEvents = scheduledEvents.filter((event) => event.tech.enforced).concat(compacted)

  // Add unscheduled events due to compaction
  unscheduledDueToCompaction = unscheduled.map((event) => ({
    ...event,
    reason: 'Unscheduled due to compaction',
  }))
  unscheduledEvents = unscheduledEvents.concat(unscheduledDueToCompaction)

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
