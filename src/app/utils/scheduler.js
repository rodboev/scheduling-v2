// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let scheduledEvents = []
  let unscheduledEvents = []
  let techSchedules = {}

  console.log(`Total events to schedule: ${events.length}`)
  console.log(`Resources available: ${resources.length}`)
  console.log(`Enforce techs: ${enforceTechs}`)

  // Sort events by start time
  events.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  // Schedule enforced events first
  events
    .filter((event) => event.tech.enforced)
    .forEach((event) => {
      const preferredTime = parseTime(event.time.preferred)
      const preferredStart = dayjs(event.start).startOf('day').add(preferredTime, 'second')
      const preferredEnd = preferredStart.add(event.time.duration, 'minute')

      scheduleEvent(event, event.tech.code, preferredStart, preferredEnd, techSchedules)
    })

  // Schedule non-enforced events
  const nonEnforcedEvents = events.filter((event) => !event.tech.enforced)
  for (const event of nonEnforcedEvents) {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    const eventDate = dayjs(event.start).startOf('day')
    const startTime = eventDate.add(rangeStart, 'second')
    const endTime = eventDate.add(rangeEnd, 'second')
    const duration = event.time.duration * 60 // duration in seconds

    let scheduled = false
    for (const resource of resources) {
      if (tryScheduleEvent(event, resource.id, startTime, endTime, duration, techSchedules)) {
        scheduled = true
        break
      }
    }

    if (!scheduled) {
      unscheduledEvents.push({
        ...event,
        reason: "Couldn't be scheduled within time range or without conflicts",
      })
    }
  }

  // Convert techSchedules back to scheduledEvents format
  scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => createEvent(event, techId)),
  )

  console.log(`Total scheduled events: ${scheduledEvents.length}`)
  console.log(`Total unscheduled events: ${unscheduledEvents.length}`)

  return { scheduledEvents, unscheduledEvents }
}

function tryScheduleEvent(event, techId, startTime, endTime, duration, techSchedules) {
  if (!techSchedules[techId]) techSchedules[techId] = []

  const schedule = techSchedules[techId]
  let potentialStart = startTime

  while (
    potentialStart.add(duration, 'second').isBefore(endTime) ||
    potentialStart.add(duration, 'second').isSame(endTime)
  ) {
    const potentialEnd = potentialStart.add(duration, 'second')

    if (canScheduleHere(schedule, potentialStart, potentialEnd)) {
      // Check if adding this event would exceed 8 hours
      const dayStart = potentialStart.startOf('day')
      const dayEnd = potentialStart.endOf('day')
      const dayEvents = schedule.filter(
        (slot) =>
          dayjs(slot.start).isSame(dayStart, 'day') || dayjs(slot.end).isSame(dayStart, 'day'),
      )

      const firstEventOfDay = dayEvents.length > 0 ? dayEvents[0].start : potentialStart
      const lastEventOfDay =
        dayEvents.length > 0 ? dayEvents[dayEvents.length - 1].end : potentialEnd

      if (dayjs(lastEventOfDay).diff(firstEventOfDay, 'second') <= MAX_WORK_HOURS) {
        scheduleEvent(event, techId, potentialStart, potentialEnd, techSchedules)
        return true
      }
    }

    potentialStart = potentialStart.add(1, 'minute')
  }

  return false
}

function canScheduleHere(schedule, start, end) {
  return !schedule.some(
    (event) => (start.isBefore(event.end) && end.isAfter(event.start)) || start.isSame(event.start),
  )
}

function scheduleEvent(event, techId, start, end, techSchedules) {
  if (!techSchedules[techId]) techSchedules[techId] = []
  techSchedules[techId].push({
    ...event,
    start,
    end,
  })
}

function createEvent(event, resourceId) {
  return {
    ...event,
    start: event.start.toDate(),
    end: event.end.toDate(),
    resourceId: resourceId,
  }
}
