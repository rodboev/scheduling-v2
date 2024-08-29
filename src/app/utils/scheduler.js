import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds

export function scheduleEvents(events, resources, enforceTechs, visibleStart, visibleEnd) {
  let techSchedules = {}
  let nextTechId = resources.length + 1
  let scheduledEventIdsByDate = new Map()

  console.log(`Total events to schedule: ${events.length}`)
  console.log(`Initial resources available: ${resources.length}`)
  console.log(`Enforce techs: ${enforceTechs}`)

  // Initialize techSchedules with existing resources
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
      scheduleEventIfNotScheduled(event, event.tech.code, techSchedules, scheduledEventIdsByDate)
    })

  // Schedule non-enforced events
  events
    .filter((event) => !event.tech.enforced)
    .forEach((event) => {
      scheduleEventWithExistingOrNewTech(event, techSchedules, scheduledEventIdsByDate, nextTechId)
      nextTechId++
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

  // Check for any remaining unallocated events (this should be rare or none)
  const unallocatedEvents = events.filter((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`
    return !scheduledEventIdsByDate.has(eventKey)
  })

  const scheduleSummary = createScheduleSummary(techSchedules, unallocatedEvents)

  console.log(`Total scheduled events: ${scheduledEvents.length}`)
  console.log(`Total unallocated events: ${unallocatedEvents.length}`)
  console.log(`Total techs used: ${Object.keys(techSchedules).length}`)

  return { scheduledEvents, unscheduledEvents: unallocatedEvents, scheduleSummary }
}

function scheduleEventWithExistingOrNewTech(
  event,
  techSchedules,
  scheduledEventIdsByDate,
  nextTechId,
) {
  let scheduled = false
  for (const techId in techSchedules) {
    if (scheduleEventIfNotScheduled(event, techId, techSchedules, scheduledEventIdsByDate)) {
      scheduled = true
      break
    }
  }
  if (!scheduled) {
    const newTechId = `Tech ${nextTechId}`
    techSchedules[newTechId] = []
    scheduleEventIfNotScheduled(event, newTechId, techSchedules, scheduledEventIdsByDate)
  }
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

// Generate detailed summary
function createScheduleSummary(techSchedules, unallocatedEvents) {
  let scheduleSummary = '\nSchedule Summary:\n\n'
  let hasPrintedEvents = false

  // Scheduled events
  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    if (schedule.length === 0) return // Skip techs with no events

    let techTotal = 0
    let techSummary = `${techId}:\n`

    schedule.sort((a, b) => a.start - b.start)

    schedule.forEach((event) => {
      const start = dayjs(event.start).format('h:mma')
      const end = dayjs(event.end).format('h:mma')
      techSummary += `- ${start}-${end}, ${event.company} (id: ${event.id})\n`
      techTotal += event.time.duration
    })

    const techTotalHours = (techTotal / 60).toFixed(1)

    if (techTotal > 0) {
      techSummary += `Total: ${techTotalHours} hours\n\n`
      scheduleSummary += techSummary
      hasPrintedEvents = true
    }
  })

  // Unallocated events
  if (unallocatedEvents.length > 0) {
    scheduleSummary += 'Unallocated services:\n'
    unallocatedEvents.forEach((event) => {
      const timeWindow = `${dayjs(event.time.range[0], 'HH:mm:ss').format('h:mma')}-${dayjs(event.time.range[1], 'HH:mm:ss').format('h:mma')}`
      scheduleSummary += `- ${timeWindow} time window, ${event.company} (id: ${event.id})\n`
    })
    hasPrintedEvents = true
  }

  return hasPrintedEvents ? scheduleSummary : ''
}
