// src/app/utils/scheduler.js

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds

export function scheduleEvents({ events, visibleStart, visibleEnd }) {
  console.time('Total scheduling time')
  console.log(`Starting scheduling process with ${events.length} events`)

  let techSchedules = {}
  let nextGenericTechId = 1
  let scheduledEventIdsByDate = new Map()

  // Separate enforced and unenforced events
  const enforcedEvents = events.filter((event) => event.tech.enforced)
  const unenforcedEvents = events.filter((event) => !event.tech.enforced)

  // Schedule enforced events first
  console.time('Enforced event scheduling')
  enforcedEvents.forEach((event) => {
    scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate)
  })
  console.timeEnd('Enforced event scheduling')

  // Sort unenforced events by time window size (ascending) and duration (descending)
  console.time('Sorting unenforced events')
  unenforcedEvents.sort((a, b) => {
    const aWindow = memoizedParseTimeRange(a.time.originalRange, a.time.duration)
    const bWindow = memoizedParseTimeRange(b.time.originalRange, b.time.duration)
    const aWindowSize = aWindow[1] - aWindow[0]
    const bWindowSize = bWindow[1] - bWindow[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
  console.timeEnd('Sorting unenforced events')

  // Schedule unenforced events
  console.time('Unenforced event scheduling')
  unenforcedEvents.forEach((event) => {
    let scheduled = false
    for (const techId in techSchedules) {
      if (
        techId.startsWith('Tech') &&
        scheduleEventWithRespectToWorkHours(event, techId, techSchedules, scheduledEventIdsByDate)
      ) {
        scheduled = true
        break
      }
    }
    if (!scheduled) {
      const newTechId = `Tech ${nextGenericTechId++}`
      techSchedules[newTechId] = []
      scheduleEventWithRespectToWorkHours(event, newTechId, techSchedules, scheduledEventIdsByDate)
    }
  })
  console.timeEnd('Unenforced event scheduling')

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: event.start.toDate(),
      end: event.end.toDate(),
      resourceId: techId,
    })),
  )

  const unscheduledEvents = events.filter((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    return !scheduledEventIdsByDate.has(`${event.id}-${eventDate}`)
  })

  const scheduleSummary = createScheduleSummary(techSchedules, unscheduledEvents)

  console.timeEnd('Total scheduling time')

  console.log(scheduleSummary)
  console.log(`Scheduling completed:`)
  console.log(`- Total events: ${events.length}`)
  console.log(`- Total scheduled events: ${scheduledEvents.length}`)
  console.log(`- Total unscheduled events: ${unscheduledEvents.length}`)
  console.log(`- Total techs used: ${Object.keys(techSchedules).length}`)

  return { scheduledEvents, unscheduledEvents, scheduleSummary }
}

function scheduleEventWithRespectToWorkHours(
  event,
  techId,
  techSchedules,
  scheduledEventIdsByDate,
) {
  const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
  const eventKey = `${event.id}-${eventDate}`

  if (!scheduledEventIdsByDate.has(eventKey)) {
    let [rangeStart, rangeEnd] = memoizedParseTimeRange(
      event.time.originalRange,
      event.time.duration,
    )
    if (isNaN(rangeStart) || isNaN(rangeEnd) || rangeEnd <= rangeStart) {
      rangeStart = 0
      rangeEnd = 24 * 60 * 60 - 1
    }
    const startTime = dayjs(event.start).startOf('day').add(rangeStart, 'second')
    const endTime = dayjs(event.start).startOf('day').add(rangeEnd, 'second')
    const duration = event.time.duration * 60

    if (
      tryScheduleEventWithinWorkHours(event, techId, startTime, endTime, duration, techSchedules)
    ) {
      scheduledEventIdsByDate.set(eventKey, techId)
      return true
    }
  }
  return false
}

function tryScheduleEventWithinWorkHours(
  event,
  techId,
  startTime,
  endTime,
  duration,
  techSchedules,
) {
  if (!techSchedules[techId]) techSchedules[techId] = []

  const schedule = techSchedules[techId]
  let potentialStart = startTime

  while (potentialStart.add(duration, 'second').isSameOrBefore(endTime)) {
    const potentialEnd = potentialStart.add(duration, 'second')

    if (!isOverlapping(schedule, potentialStart, potentialEnd)) {
      const dayEvents = getDayEvents(schedule, potentialStart)
      const updatedDayEvents = [...dayEvents, { start: potentialStart, end: potentialEnd }]

      if (isWithinWorkHours(updatedDayEvents)) {
        techSchedules[techId].push({
          ...event,
          start: potentialStart,
          end: potentialEnd,
        })
        return true
      }
    }

    // Find the next possible start time
    const nextEvent = schedule.find((e) => e.start > potentialStart)
    potentialStart = nextEvent ? dayjs(nextEvent.end) : potentialStart.add(1, 'minute')
  }

  return false
}

function isOverlapping(schedule, start, end) {
  return schedule.some(
    (existingEvent) =>
      (start.isBefore(existingEvent.end) && end.isAfter(existingEvent.start)) ||
      start.isSame(existingEvent.start),
  )
}

function getDayEvents(schedule, day) {
  return schedule.filter((slot) => dayjs(slot.start).isSame(day, 'day'))
}

function isWithinWorkHours(events) {
  if (events.length === 0) return true
  events.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))
  const totalDuration = events.reduce(
    (sum, event) => sum + dayjs(event.end).diff(event.start, 'second'),
    0,
  )
  return totalDuration <= MAX_WORK_HOURS
}

function scheduleNonEnforcedEvent(
  event,
  techSchedules,
  scheduledEventIdsByDate,
  nextGenericTechId,
) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const startTime = dayjs(event.start).startOf('day').add(rangeStart, 'second')
  const endTime = dayjs(event.start).startOf('day').add(rangeEnd, 'second')
  const duration = event.time.duration * 60

  let bestTechId = null
  let bestStartTime = null
  let smallestGap = Infinity

  // Try to find the best fit among existing techs
  for (const techId in techSchedules) {
    if (techId.startsWith('Tech')) {
      const result = findBestFit(event, techSchedules[techId], startTime, endTime, duration)
      if (result && result.gap < smallestGap) {
        bestTechId = techId
        bestStartTime = result.startTime
        smallestGap = result.gap
      }
    }
  }

  // If no suitable existing tech found, create a new one
  if (!bestTechId) {
    bestTechId = `Tech ${nextGenericTechId++}`
    techSchedules[bestTechId] = []
    bestStartTime = startTime
  }

  // Schedule the event
  const eventEnd = bestStartTime.add(duration, 'second')
  techSchedules[bestTechId].push({
    ...event,
    start: bestStartTime,
    end: eventEnd,
  })

  const eventDate = bestStartTime.format('YYYY-MM-DD')
  scheduledEventIdsByDate.set(`${event.id}-${eventDate}`, bestTechId)
}

function findBestFit(event, schedule, startTime, endTime, duration) {
  let bestStartTime = null
  let smallestGap = Infinity

  if (schedule.length === 0) {
    return { startTime, gap: 0 }
  }

  schedule.sort((a, b) => a.start - b.start)

  // Check before the first event
  if (startTime.add(duration, 'second').isSameOrBefore(schedule[0].start)) {
    const gap = schedule[0].start.diff(startTime.add(duration, 'second'), 'second')
    return { startTime, gap }
  }

  // Check between events
  for (let i = 0; i < schedule.length - 1; i++) {
    const gapStart = schedule[i].end
    const gapEnd = schedule[i + 1].start
    const gapSize = gapEnd.diff(gapStart, 'second')

    if (gapSize >= duration) {
      const potentialStart = dayjs.max(gapStart, startTime)
      if (
        potentialStart.add(duration, 'second').isSameOrBefore(gapEnd) &&
        potentialStart.add(duration, 'second').isSameOrBefore(endTime)
      ) {
        const gap = gapSize - duration
        if (gap < smallestGap) {
          bestStartTime = potentialStart
          smallestGap = gap
        }
      }
    }
  }

  // Check after the last event
  const lastEventEnd = schedule[schedule.length - 1].end
  if (lastEventEnd.isSameOrBefore(endTime.subtract(duration, 'second'))) {
    const potentialStart = dayjs.max(lastEventEnd, startTime)
    if (potentialStart.add(duration, 'second').isSameOrBefore(endTime)) {
      const gap = endTime.diff(potentialStart.add(duration, 'second'), 'second')
      if (gap < smallestGap) {
        bestStartTime = potentialStart
        smallestGap = gap
      }
    }
  }

  if (bestStartTime) {
    return { startTime: bestStartTime, gap: smallestGap }
  }

  return null
}

function scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate) {
  const techId = event.tech.code
  if (!techSchedules[techId]) techSchedules[techId] = []

  const preferredTime = parseTime(event.time.preferred)
  const startTime = dayjs(event.start).startOf('day').add(preferredTime, 'second')
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
