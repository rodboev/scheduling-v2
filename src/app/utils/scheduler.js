// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let scheduledEvents = []
  let unscheduledEvents = []
  let techSchedules = {}

  // Initialize techSchedules
  resources.forEach((resource) => {
    techSchedules[resource.id] = []
  })

  // Sort events by time window size (ascending) and duration (descending)
  events.sort((a, b) => {
    const aWindow = parseTimeRange(a.time.originalRange, a.time.duration)
    const bWindow = parseTimeRange(b.time.originalRange, b.time.duration)
    const aWindowSize = aWindow[1] - aWindow[0]
    const bWindowSize = bWindow[1] - bWindow[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })

  // Schedule enforced events first
  events
    .filter((event) => event.tech.enforced)
    .forEach((event) => {
      const preferredTime = parseTime(event.time.preferred)
      const preferredStart = dayjs(event.start).startOf('day').add(preferredTime, 'second')
      const preferredEnd = preferredStart.add(event.time.duration, 'minute')

      if (
        tryScheduleEvent(
          event,
          event.tech.code,
          preferredStart,
          preferredEnd,
          event.time.duration * 60,
          techSchedules,
        )
      ) {
        // Event scheduled successfully
      } else {
        unscheduledEvents.push({
          ...event,
          reason: "Couldn't be scheduled within work day limit",
          time: {
            ...event.time,
            range: [preferredStart.toDate(), preferredEnd.toDate()],
          },
        })
      }
    })

  // Schedule non-enforced events
  events
    .filter((event) => !event.tech.enforced)
    .forEach((event) => {
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
          reason: "Couldn't be scheduled within time range or work day limit",
          time: {
            ...event.time,
            range: [startTime.toDate(), endTime.toDate()],
          },
        })
      }
    })

  // Try to fill gaps with unscheduled events
  unscheduledEvents = tryFillGaps(unscheduledEvents, techSchedules, resources)

  // Convert techSchedules back to scheduledEvents format
  scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => createEvent(event, techId)),
  )

  console.log(`Total scheduled events: ${scheduledEvents.length}`)
  console.log(`Total unscheduled events: ${unscheduledEvents.length}`)

  return { scheduledEvents, unscheduledEvents }
}

function tryFillGaps(unscheduledEvents, techSchedules, resources) {
  let stillUnscheduled = []

  for (const event of unscheduledEvents) {
    let scheduled = false
    for (const resource of resources) {
      const [rangeStart, rangeEnd] = event.time.range
      if (
        tryScheduleEvent(
          event,
          resource.id,
          dayjs(rangeStart),
          dayjs(rangeEnd),
          event.time.duration * 60,
          techSchedules,
        )
      ) {
        scheduled = true
        break
      }
    }
    if (!scheduled) {
      stillUnscheduled.push(event)
    }
  }

  return stillUnscheduled
}

function tryScheduleEvent(event, techId, startTime, endTime, duration, techSchedules) {
  const schedule = techSchedules[techId]
  let potentialStart = startTime

  while (potentialStart.add(duration, 'second').isSameOrBefore(endTime)) {
    const potentialEnd = potentialStart.add(duration, 'second')

    if (canScheduleHere(schedule, potentialStart, potentialEnd)) {
      const dayEvents = getDayEvents(schedule, potentialStart)
      const updatedDayEvents = [...dayEvents, { start: potentialStart, end: potentialEnd }]

      if (isWithinWorkdayLimit(updatedDayEvents)) {
        scheduleEvent(event, techId, potentialStart, potentialEnd, techSchedules)
        return true
      }
    }

    potentialStart = potentialStart.add(1, 'minute')
  }

  return false
}

function isWithinWorkdayLimit(dayEvents) {
  if (dayEvents.length === 0) return true

  dayEvents.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))
  const firstEventStart = dayjs(dayEvents[0].start)
  const lastEventEnd = dayjs(dayEvents[dayEvents.length - 1].end)

  const totalWorkTime = lastEventEnd.diff(firstEventStart, 'second')
  return totalWorkTime <= MAX_WORK_HOURS
}

function getDayEvents(schedule, date) {
  const dayStart = date.startOf('day')
  const dayEnd = date.endOf('day')
  return schedule.filter(
    (slot) =>
      (dayjs(slot.start).isSameOrAfter(dayStart) && dayjs(slot.start).isBefore(dayEnd)) ||
      (dayjs(slot.end).isAfter(dayStart) && dayjs(slot.end).isSameOrBefore(dayEnd)),
  )
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
