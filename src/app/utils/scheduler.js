import { dayjsInstance as dayjs } from './dayjs'
import PriorityQueue from 'priorityqueuejs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds
const TIME_INCREMENT = 15 * 60 // 15 minutes in seconds
const MAX_BACKTRACK_ATTEMPTS = 5

// Helper function to ensure we're always working with dayjs objects
function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

// Helper function to convert dayjs to Date, or return Date as is
function ensureDate(date) {
  return dayjs.isDayjs(date) ? date.toDate() : date
}

export function scheduleEvents({ events, visibleStart, visibleEnd }) {
  console.time('Total scheduling time')
  console.log(`Starting scheduling process with ${events.length} events`)

  let techSchedules = {}
  let nextGenericTechId = 1
  let scheduledEventIdsByDate = new Map()
  let unscheduledEvents = []

  // Sort events by time window size (ascending) and duration (descending)
  console.time('Sorting events')
  events.sort((a, b) => {
    const aWindow = memoizedParseTimeRange(a.time.originalRange, a.time.duration)
    const bWindow = memoizedParseTimeRange(b.time.originalRange, b.time.duration)
    const aWindowSize = aWindow[1] - aWindow[0]
    const bWindowSize = bWindow[1] - bWindow[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
  console.timeEnd('Sorting events')

  // Schedule all events
  console.time('Scheduling events')
  events.forEach((event) => {
    let scheduled = false
    if (event.tech.enforced) {
      scheduled = scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate)
    } else {
      scheduled = scheduleEventWithBacktracking(
        event,
        techSchedules,
        scheduledEventIdsByDate,
        nextGenericTechId,
      )
      if (scheduled) {
        nextGenericTechId =
          Math.max(
            nextGenericTechId,
            ...Object.keys(techSchedules).map((id) => parseInt(id.split(' ')[1] || 0)),
          ) + 1
      }
    }

    if (!scheduled) {
      unscheduledEvents.push(event)
    }
  })
  console.timeEnd('Scheduling events')

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: new Date(event.start), // Ensure this is a JavaScript Date object
      end: new Date(event.end), // Ensure this is a JavaScript Date object
      resourceId: techId,
    })),
  )

  const scheduleSummary = createScheduleSummary(techSchedules, unscheduledEvents)

  console.timeEnd('Total scheduling time')

  console.log(scheduleSummary)
  console.log(`Scheduling completed:`)
  console.log(`- Total events: ${events.length}`)
  console.log(`- Total scheduled events: ${scheduledEvents.length}`)
  console.log(`- Total unscheduled events: ${unscheduledEvents.length}`)
  console.log(`- Total techs used: ${Object.keys(techSchedules).length}`)

  return {
    scheduledEvents,
    unscheduledEvents: unscheduledEvents.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
    })),
    scheduleSummary,
  }
}

function scheduleEventWithBacktracking(
  event,
  techSchedules,
  scheduledEventIdsByDate,
  nextGenericTechId,
) {
  const backtrackStack = []
  let attempts = 0

  while (attempts < MAX_BACKTRACK_ATTEMPTS) {
    for (const techId in techSchedules) {
      const result = scheduleEventWithRespectToWorkHours(
        event,
        techId,
        techSchedules,
        scheduledEventIdsByDate,
      )
      if (result.scheduled) {
        return true
      }
    }

    // If we couldn't schedule with existing techs, create a new one
    const newTechId = `Tech ${nextGenericTechId++}`
    techSchedules[newTechId] = []
    const result = scheduleEventWithRespectToWorkHours(
      event,
      newTechId,
      techSchedules,
      scheduledEventIdsByDate,
    )
    if (result.scheduled) {
      return true
    }

    // If we still couldn't schedule, backtrack
    if (backtrackStack.length > 0) {
      const { removedEvent, removedFromTechId } = backtrackStack.pop()
      removeEventFromSchedule(
        removedEvent,
        removedFromTechId,
        techSchedules,
        scheduledEventIdsByDate,
      )
      attempts++
    } else {
      break
    }
  }

  return false
}

function scheduleEventWithRespectToWorkHours(
  event,
  techId,
  techSchedules,
  scheduledEventIdsByDate,
) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const earliestStart = ensureDayjs(event.start).startOf('day').add(rangeStart, 'second')
  const latestStart = ensureDayjs(event.start)
    .startOf('day')
    .add(rangeEnd, 'second')
    .subtract(event.time.duration, 'minute')

  if (!techSchedules[techId]) techSchedules[techId] = []

  const schedule = techSchedules[techId]
  const gaps = findScheduleGaps(schedule, earliestStart, latestStart)

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      const startTime = gap.start
      const endTime = startTime.add(event.time.duration, 'minute')

      if (isWithinWorkHours(schedule, startTime, endTime)) {
        const scheduledEvent = { ...event, start: ensureDate(startTime), end: ensureDate(endTime) }
        addEvent(schedule, scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, techId)

        return { scheduled: true, reason: null }
      }
    }
  }

  return { scheduled: false, reason: 'No available time slot within the specified range' }
}

function findScheduleGaps(schedule, start, end) {
  const gaps = []
  let currentTime = ensureDayjs(start)
  const endTime = ensureDayjs(end)

  schedule.forEach((event) => {
    const eventStart = ensureDayjs(event.start)
    const eventEnd = ensureDayjs(event.end)
    if (eventStart.isAfter(currentTime)) {
      gaps.push({ start: currentTime, end: eventStart })
    }
    currentTime = dayjs.max(currentTime, eventEnd)
  })

  if (endTime.isAfter(currentTime)) {
    gaps.push({ start: currentTime, end: endTime })
  }

  return gaps
}

function isWithinWorkHours(schedule, start, end) {
  const dayEvents = [
    ...schedule.map((e) => ({ start: ensureDayjs(e.start), end: ensureDayjs(e.end) })),
    { start: ensureDayjs(start), end: ensureDayjs(end) },
  ].filter((e) => e.start.isSame(ensureDayjs(start), 'day'))
  dayEvents.sort((a, b) => a.start.diff(b.start))
  const totalDuration = dayEvents[dayEvents.length - 1].end.diff(dayEvents[0].start, 'second')
  return totalDuration <= MAX_WORK_HOURS
}

function isOverlapping(schedule, start, end) {
  return schedule.some(
    (existingEvent) =>
      (ensureDayjs(start).isBefore(ensureDayjs(existingEvent.end)) &&
        ensureDayjs(end).isAfter(ensureDayjs(existingEvent.start))) ||
      ensureDayjs(start).isSame(ensureDayjs(existingEvent.start)),
  )
}

function addEvent(schedule, event) {
  const index = schedule.findIndex((e) => ensureDayjs(e.start).isAfter(ensureDayjs(event.start)))
  if (index === -1) {
    schedule.push(event)
  } else {
    schedule.splice(index, 0, event)
  }
}

function removeEventFromSchedule(event, techId, techSchedules, scheduledEventIdsByDate) {
  techSchedules[techId] = techSchedules[techId].filter((e) => e.id !== event.id)
  const eventDate = ensureDayjs(event.start).format('YYYY-MM-DD')
  const eventKey = `${event.id}-${eventDate}`
  scheduledEventIdsByDate.delete(eventKey)
}

function scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate) {
  const techId = event.tech.code
  if (!techSchedules[techId]) techSchedules[techId] = []

  const preferredTime = parseTime(event.time.preferred)
  const startTime = ensureDayjs(event.start).startOf('day').add(preferredTime, 'second')
  const endTime = startTime.add(event.time.duration, 'minute')

  techSchedules[techId].push({
    ...event,
    start: startTime,
    end: endTime,
  })

  const eventDate = startTime.format('YYYY-MM-DD')
  const eventKey = `${event.id}-${eventDate}`
  scheduledEventIdsByDate.set(eventKey, techId)

  return true
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

    schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

    schedule.forEach((event) => {
      const start = ensureDayjs(event.start).format('h:mma')
      const end = ensureDayjs(event.end).format('h:mma')
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
      const timeWindow = formatTimeRange(event.time.range[0], event.time.range[1])
      scheduleSummary += `- ${timeWindow} time window, ${event.company} (id: ${event.id})\n`
    })
    hasPrintedEvents = true
  }

  return hasPrintedEvents ? scheduleSummary : ''
}
