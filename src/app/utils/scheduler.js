import { memoize } from 'lodash'
import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 // 8 hours in minutes
const TIME_INCREMENT = 15 * 60 // 15 minutes in seconds
const MAX_BACKTRACK_ATTEMPTS = 5
const MIN_REST_HOURS = 16 // 12 hours minimum rest between shifts

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

function ensureDate(date) {
  return dayjs.isDayjs(date) ? date.toDate() : date
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function getNextAvailableTechId(techSchedules, nextGenericTechId) {
  const existingIds = Object.keys(techSchedules)
    .filter((id) => id.startsWith('Tech '))
    .map((id) => {
      const num = parseInt(id.split(' ')[1])
      return isNaN(num) ? 0 : num // Convert NaN to 0
    })
    .sort((a, b) => a - b)

  if (existingIds.length === 0) return nextGenericTechId

  let nextId = nextGenericTechId
  while (existingIds.includes(nextId) || nextId <= Math.max(...existingIds)) {
    nextId++
  }

  return nextId
}

export async function scheduleEvents({ events, visibleStart, visibleEnd }, onProgress) {
  console.time('Total scheduling time')
  console.log(`Starting scheduling process with ${events.length} events`)

  const techSchedules = {}
  const scheduledEventIdsByDate = new Map()
  let nextGenericTechId = 1
  const unscheduledEvents = []

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

  const totalEvents = events.length
  let processedCount = 0

  // Schedule all events
  console.time('Scheduling events')
  for (const event of events) {
    let scheduled = false
    if (event.tech.enforced) {
      scheduled = scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate)
    }
    else {
      const result = scheduleEventWithBacktracking(
        event,
        techSchedules,
        scheduledEventIdsByDate,
        nextGenericTechId,
      )
      scheduled = result.scheduled
      nextGenericTechId = result.nextGenericTechId
    }

    if (!scheduled) {
      unscheduledEvents.push(event)
    }

    processedCount++
    const percentage = Math.round((processedCount / totalEvents) * 100)
    onProgress(percentage)

    // Force a small delay every 10 events to allow for UI updates
    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  // Try to schedule unscheduled events one more time, creating new techs if necessary
  const remainingUnscheduled = await tryScheduleUnscheduledEvents(
    unscheduledEvents,
    techSchedules,
    scheduledEventIdsByDate,
    nextGenericTechId,
    onProgress, // Pass onProgress here
    totalEvents,
    processedCount,
  )

  console.timeEnd('Scheduling events')

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
      resourceId: techId,
    })),
  )

  console.timeEnd('Total scheduling time')

  // Remove any empty tech schedules
  Object.keys(techSchedules).forEach((techId) => {
    if (techSchedules[techId].length === 0) {
      delete techSchedules[techId]
    }
  })

  printSummary(techSchedules, remainingUnscheduled)

  return {
    scheduledEvents,
    unscheduledEvents: remainingUnscheduled.map((event) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
    })),
    nextGenericTechId,
    techSchedules, // Add this line to include techSchedules in the return value
  }
}

async function tryScheduleUnscheduledEvents(
  unscheduledEvents,
  techSchedules,
  scheduledEventIdsByDate,
  nextGenericTechId,
  onProgress,
  totalEvents,
  initialProcessedCount,
) {
  const remainingUnscheduled = []
  let processedCount = initialProcessedCount

  for (const event of unscheduledEvents) {
    let scheduled = false
    let reason = ''

    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      const result = findBestSlotForEvent(event, techId, techSchedules)
      if (result.scheduled) {
        scheduled = true
        const startTime = result.startTime
        const endTime = startTime.add(event.time.duration, 'minute')
        const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
        addEvent(techSchedules[techId], scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, techId)
        break
      }
      else {
        reason = result.reason || 'No suitable time slot found'
      }
    }

    // If not scheduled, create a new tech
    if (!scheduled) {
      const newTechId = `Tech ${nextGenericTechId++}`
      techSchedules[newTechId] = []
      const result = findBestSlotForEvent(event, newTechId, techSchedules)
      if (result.scheduled) {
        const startTime = result.startTime
        const endTime = startTime.add(event.time.duration, 'minute')
        const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
        addEvent(techSchedules[newTechId], scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, newTechId)
        scheduled = true
      }
      else {
        reason = result.reason
      }
    }

    if (!scheduled) {
      event.reason = reason
      remainingUnscheduled.push(event)
    }

    processedCount++
    const percentage = Math.min(100, Math.round((processedCount / totalEvents) * 100))
    onProgress(percentage)

    // Force a small delay every 10 events to allow for UI updates
    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  return remainingUnscheduled
}

function findScheduleGaps(schedule, start, end) {
  const gaps = []
  let currentTime = dayjs(start)
  const endTime = dayjs(end)

  schedule.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  schedule.forEach((event) => {
    const eventStart = dayjs(event.start)
    const eventEnd = dayjs(event.end)
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

function isWithinWorkHours(techSchedule, start, end) {
  const dayEvents = [
    ...techSchedule.map((e) => ({ start: dayjs(e.start), end: dayjs(e.end) })),
    { start: dayjs(start), end: dayjs(end) },
  ].filter((e) => e.start.isSame(dayjs(start), 'day') || e.end.isSame(dayjs(start), 'day'))

  if (dayEvents.length === 0) {
    return true
  }

  dayEvents.sort((a, b) => a.start.diff(b.start))
  const totalDuration = dayEvents[dayEvents.length - 1].end.diff(dayEvents[0].start, 'minute')

  return totalDuration <= MAX_WORK_HOURS
}

function calculateWorkload(techSchedule, start, end) {
  const dayEvents = [
    ...techSchedule.map((e) => ({ start: dayjs(e.start), end: dayjs(e.end) })),
    { start: dayjs(start), end: dayjs(end) },
  ].filter((e) => e.start.isSame(dayjs(start), 'day'))

  if (dayEvents.length === 0) return 0

  dayEvents.sort((a, b) => a.start.diff(b.start))
  return dayEvents[dayEvents.length - 1].end.diff(dayEvents[0].start, 'minute')
}

function findBestSlotForEvent(event, techId, techSchedules) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const earliestStart = dayjs(event.start).startOf('day').add(rangeStart, 'second')
  const latestEnd = dayjs(event.start).startOf('day').add(rangeEnd, 'second')

  const techSchedule = techSchedules[techId] || []
  const gaps = findScheduleGaps(techSchedule, earliestStart, latestEnd)

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      const potentialStartTime = gap.start
      const potentialEndTime = potentialStartTime.add(event.time.duration, 'minute')

      // Check if this event would exceed the 8-hour limit in a 24-hour period
      const dayStart = potentialStartTime.startOf('day')
      const dayEnd = dayStart.add(1, 'day')
      const dayEvents = techSchedule.filter(
        (e) =>
          dayjs(e.start).isBetween(dayStart, dayEnd, null, '[]') ||
          dayjs(e.end).isBetween(dayStart, dayEnd, null, '[]'),
      )

      const totalWorkMinutes =
        dayEvents.reduce((total, e) => {
          const eventStart = dayjs.max(dayjs(e.start), dayStart)
          const eventEnd = dayjs.min(dayjs(e.end), dayEnd)
          return total + eventEnd.diff(eventStart, 'minute')
        }, 0) + event.time.duration

      if (totalWorkMinutes <= MAX_WORK_HOURS) {
        return {
          scheduled: true,
          startTime: potentialStartTime,
          workload: calculateWorkload(techSchedule, potentialStartTime, potentialEndTime),
        }
      }
    }
  }

  return {
    scheduled: false,
    startTime: null,
    workload: Infinity,
    reason: `No suitable time slot found between ${earliestStart.format('h:mma')} and ${latestEnd.format('h:mma')} within 8-hour work limit`,
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
    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      const result = scheduleEventWithRespectToWorkHours(
        event,
        techId,
        techSchedules,
        scheduledEventIdsByDate,
      )
      if (result.scheduled) {
        return { scheduled: true, nextGenericTechId }
      }
    }

    // If we couldn't schedule with existing techs, create a new one
    const newTechId = getNextAvailableTechId(techSchedules, nextGenericTechId)
    const result = scheduleEventWithRespectToWorkHours(
      event,
      `Tech ${newTechId}`,
      techSchedules,
      scheduledEventIdsByDate,
    )
    if (result.scheduled) {
      return { scheduled: true, nextGenericTechId: newTechId + 1 }
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
    }
    else {
      break
    }
  }

  return { scheduled: false, nextGenericTechId }
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
  const latestEnd = ensureDayjs(event.start).startOf('day').add(rangeEnd, 'second')

  const schedule = techSchedules[techId] || []
  const gaps = findScheduleGaps(schedule, earliestStart, latestEnd)

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      const startTime = gap.start
      const endTime = startTime.add(event.time.duration, 'minute')

      if (isWithinWorkHours(schedule, startTime, endTime)) {
        const scheduledEvent = { ...event, start: ensureDate(startTime), end: ensureDate(endTime) }

        // Only create the tech schedule if it doesn't exist
        if (!techSchedules[techId]) {
          techSchedules[techId] = []
        }
        addEvent(techSchedules[techId], scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, techId)

        return { scheduled: true, reason: null }
      }
    }
  }

  return { scheduled: false, reason: 'No available time slot within the specified range' }
}

function addEvent(schedule, event) {
  const index = schedule.findIndex((e) => ensureDayjs(e.start).isAfter(ensureDayjs(event.start)))
  if (index === -1) {
    schedule.push(event)
  }
  else {
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

function printSummary(techSchedules, unscheduledEvents) {
  let scheduleSummary = 'Schedule Summary:\n\n'
  let hasPrintedEvents = false

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    let techTotal = 0
    let techSummary = `${techId}:\n`

    schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

    schedule.forEach((event) => {
      const date = ensureDayjs(event.start).format('M/D')
      const start = ensureDayjs(event.start).format('h:mma')
      const end = ensureDayjs(event.end).format('h:mma')
      techSummary += `- ${date}, ${start}-${end}, ${event.company} (id: ${event.id})\n`
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
  if (unscheduledEvents.length > 0) {
    scheduleSummary += 'Unallocated services:\n'
    unscheduledEvents.forEach((event) => {
      const date = ensureDayjs(event.start).format('M/D')
      const timeWindow = formatTimeRange(event.time.range[0], event.time.range[1])
      scheduleSummary += `- ${date}, ${timeWindow} time window, ${event.company} (id: ${event.id}), Reason: ${event.reason}\n`
    })
    hasPrintedEvents = true
  }

  if (hasPrintedEvents) {
    console.log(scheduleSummary)
  }
}
