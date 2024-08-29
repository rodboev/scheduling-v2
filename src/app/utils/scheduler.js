import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let techSchedules = {}
  let nextTechId = 1
  let scheduledEventIdsByDate = new Map()

  console.log(`Total events to schedule: ${events.length}`)
  console.log(`Initial resources available: ${resources.length}`)
  console.log(`Enforce techs: ${enforceTechs}`)

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
      scheduleEventIfNotScheduled(event, event.tech.code, techSchedules, scheduledEventIdsByDate)
    })

  // Schedule non-enforced events
  events
    .filter((event) => !event.tech.enforced)
    .forEach((event) => {
      let scheduled = false
      for (const techId in techSchedules) {
        if (scheduleEventIfNotScheduled(event, techId, techSchedules, scheduledEventIdsByDate)) {
          scheduled = true
          break
        }
      }
      if (!scheduled) {
        const newTechId = `Tech ${nextTechId++}`
        scheduleEventIfNotScheduled(event, newTechId, techSchedules, scheduledEventIdsByDate)
      }
    })

  // Optimize the schedule
  optimizeSchedule(techSchedules, scheduledEventIdsByDate)

  // Try to fill gaps with unscheduled events
  tryFillGaps(events, techSchedules, scheduledEventIdsByDate)

  // Final attempt to schedule any remaining events
  events.forEach((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`
    if (!scheduledEventIdsByDate.has(eventKey)) {
      const newTechId = `Tech ${nextTechId++}`
      scheduleEventIfNotScheduled(event, newTechId, techSchedules, scheduledEventIdsByDate)
    }
  })

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: event.start.toDate(),
      end: event.end.toDate(),
      resourceId: techId,
    })),
  )

  // Identify truly unallocated events
  const unallocatedEvents = events.filter((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`
    return !scheduledEventIdsByDate.has(eventKey)
  })

  console.log(`Total scheduled events: ${scheduledEvents.length}`)
  console.log(`Total unallocated events: ${unallocatedEvents.length}`)
  console.log(`Total techs used: ${Object.keys(techSchedules).length}`)

  return { scheduledEvents, unscheduledEvents: unallocatedEvents }
}

function scheduleEventIfNotScheduled(event, techId, techSchedules, scheduledEventIdsByDate) {
  const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
  const eventKey = `${event.id}-${eventDate}`

  if (!scheduledEventIdsByDate.has(eventKey)) {
    const [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    const startTime = dayjs(event.start).startOf('day').add(rangeStart, 'second')
    const endTime = dayjs(event.start).startOf('day').add(rangeEnd, 'second')
    const duration = event.time.duration * 60 // duration in seconds

    if (tryScheduleEvent(event, techId, startTime, endTime, duration, techSchedules)) {
      scheduledEventIdsByDate.set(eventKey, techId)
      return true
    }
  }
  return false
}

function tryScheduleEvent(event, techId, startTime, endTime, duration, techSchedules) {
  if (!techSchedules[techId]) techSchedules[techId] = []

  const schedule = techSchedules[techId]
  let potentialStart = startTime

  while (potentialStart.add(duration, 'second').isSameOrBefore(endTime)) {
    const potentialEnd = potentialStart.add(duration, 'second')

    if (
      !schedule.some(
        (existingEvent) =>
          (potentialStart.isBefore(existingEvent.end) &&
            potentialEnd.isAfter(existingEvent.start)) ||
          potentialStart.isSame(existingEvent.start),
      )
    ) {
      const dayStart = potentialStart.startOf('day')
      const dayEnd = potentialStart.endOf('day')
      const dayEvents = schedule.filter(
        (slot) =>
          (dayjs(slot.start).isSameOrAfter(dayStart) && dayjs(slot.start).isBefore(dayEnd)) ||
          (dayjs(slot.end).isAfter(dayStart) && dayjs(slot.end).isSameOrBefore(dayEnd)),
      )
      const updatedDayEvents = [...dayEvents, { start: potentialStart, end: potentialEnd }]

      if (
        updatedDayEvents.length === 0 ||
        (updatedDayEvents.sort((a, b) => dayjs(a.start).diff(dayjs(b.start))),
        dayjs(updatedDayEvents[updatedDayEvents.length - 1].end).diff(
          dayjs(updatedDayEvents[0].start),
          'second',
        ) <= MAX_WORK_HOURS)
      ) {
        techSchedules[techId].push({
          ...event,
          start: potentialStart,
          end: potentialEnd,
        })
        return true
      }
    }

    potentialStart = potentialStart.add(1, 'minute')
  }

  return false
}

function tryFillGaps(events, techSchedules, scheduledEventIdsByDate) {
  events.forEach((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`
    if (!scheduledEventIdsByDate.has(eventKey)) {
      for (const techId in techSchedules) {
        if (scheduleEventIfNotScheduled(event, techId, techSchedules, scheduledEventIdsByDate)) {
          break
        }
      }
    }
  })
}

function optimizeSchedule(techSchedules, scheduledEventIdsByDate) {
  const allEvents = Object.values(techSchedules).flat()
  allEvents.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  const optimizedSchedules = {}

  allEvents.forEach((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`

    if (scheduledEventIdsByDate.has(eventKey)) {
      const currentTechId = scheduledEventIdsByDate.get(eventKey)
      scheduledEventIdsByDate.delete(eventKey)

      let scheduled = false
      for (const techId in optimizedSchedules) {
        if (
          tryScheduleEvent(
            event,
            techId,
            event.start,
            event.end,
            event.time.duration * 60,
            optimizedSchedules,
          )
        ) {
          scheduledEventIdsByDate.set(eventKey, techId)
          scheduled = true
          break
        }
      }

      if (!scheduled) {
        tryScheduleEvent(
          event,
          currentTechId,
          event.start,
          event.end,
          event.time.duration * 60,
          optimizedSchedules,
        )
        scheduledEventIdsByDate.set(eventKey, currentTechId)
      }
    }
  })

  Object.assign(techSchedules, optimizedSchedules)
}

function scheduleEvent(event, techId, start, end, techSchedules) {
  if (!techSchedules[techId]) techSchedules[techId] = []
  techSchedules[techId].push({
    ...event,
    start,
    end,
  })
}

function isEventScheduledForDate(eventId, date, scheduledEventIdsByDate) {
  return scheduledEventIdsByDate.has(date) && scheduledEventIdsByDate.get(date).has(eventId)
}

function addScheduledEventForDate(eventId, date, scheduledEventIdsByDate) {
  if (!scheduledEventIdsByDate.has(date)) {
    scheduledEventIdsByDate.set(date, new Set())
  }
  scheduledEventIdsByDate.get(date).add(eventId)
}
