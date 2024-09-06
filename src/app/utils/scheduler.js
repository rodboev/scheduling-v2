import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_SHIFT_DURATION = 8 * 60 // 8 hours in minutes
const MAX_GAP_BETWEEN_EVENTS = 120 // 2 hours
const MIN_REST_HOURS = 16 // 16 hours minimum rest between shifts
const MAX_BACKTRACK_ATTEMPTS = 5
const MAX_WORK_HOURS = 8 * 60 // 8 hours in minutes

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

function ensureDate(date) {
  return dayjs.isDayjs(date) ? date.toDate() : date
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function getNextAvailableTechId(techSchedules, nextGenericTechId) {
  const existingIds = Object.keys(techSchedules)
    .filter(id => id.startsWith('Tech '))
    .map(id => {
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

  const techSchedules = {}
  const scheduledEventIdsByDate = new Map()
  let nextGenericTechId = 1
  const unscheduledEvents = []

  // Sort events by date, then by time window size (ascending) and duration (descending)
  console.time('Sorting events')
  events.sort((a, b) => {
    const aDate = ensureDayjs(a.start).startOf('day')
    const bDate = ensureDayjs(b.start).startOf('day')
    if (!aDate.isSame(bDate)) {
      return aDate.diff(bDate)
    }
    const aWindow = memoizedParseTimeRange(a.time.originalRange, a.time.duration)
    const bWindow = memoizedParseTimeRange(b.time.originalRange, b.time.duration)
    const aWindowSize = aWindow[1] - aWindow[0]
    const bWindowSize = bWindow[1] - bWindow[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
  console.timeEnd('Sorting events')

  const totalEvents = events.length
  let processedCount = 0

  for (const event of events) {
    let scheduled = false
    let reason = ''

    if (event.tech.enforced) {
      scheduled = scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate)
      if (!scheduled) {
        reason = 'Could not schedule enforced event'
      }
    }
    else {
      // Try to schedule with existing techs
      for (const techId in techSchedules) {
        const result = scheduleEventWithRespectToWorkHours(
          event,
          techId,
          techSchedules,
          scheduledEventIdsByDate,
        )
        if (result.scheduled) {
          scheduled = true
          break
        }
        else {
          reason = result.reason
        }
      }

      // If not scheduled, create a new tech
      if (!scheduled) {
        while (`Tech ${nextGenericTechId}` in techSchedules) {
          nextGenericTechId++
        }
        const newTechId = `Tech ${nextGenericTechId}`
        const result = scheduleEventWithRespectToWorkHours(
          event,
          newTechId,
          techSchedules,
          scheduledEventIdsByDate,
        )
        scheduled = result.scheduled
        if (!scheduled) {
          reason = result.reason
        }
      }
    }

    if (!scheduled) {
      unscheduledEvents.push({ ...event, reason })
    }

    processedCount++
    const percentage = Math.round((processedCount / totalEvents) * 100)
    onProgress(percentage)

    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map(event => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
      resourceId: techId,
    })),
  )

  console.timeEnd('Total scheduling time')

  // Remove any empty tech schedules
  Object.keys(techSchedules).forEach(techId => {
    if (techSchedules[techId].length === 0) {
      delete techSchedules[techId]
    }
  })

  printSummary(techSchedules, unscheduledEvents)

  const result = {
    scheduledEvents: Object.entries(techSchedules).flatMap(([techId, schedule]) =>
      schedule.map(event => ({
        ...event,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        resourceId: techId,
      })),
    ),
    unscheduledEvents: unscheduledEvents.map(event => ({
      ...event,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
    })),
    nextGenericTechId,
  }

  return result
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

function calculateWorkload(techSchedule, start, end) {
  const dayEvents = [
    ...techSchedule.map(e => ({ start: dayjs(e.start), end: dayjs(e.end) })),
    { start: dayjs(start), end: dayjs(end) },
  ].filter(e => e.start.isSame(dayjs(start), 'day'))

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

  let bestSlot = null
  let minGap = Infinity

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      const potentialStartTime = gap.start
      const potentialEndTime = potentialStartTime.add(event.time.duration, 'minute')

      // Check if this event would exceed the 8-hour limit in a 24-hour period
      const dayStart = potentialStartTime.startOf('day')
      const dayEnd = dayStart.add(1, 'day')
      const dayEvents = techSchedule.filter(
        e =>
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
        const gapToNearestEvent = findGapToNearestEvent(
          potentialStartTime,
          potentialEndTime,
          techSchedule,
        )
        if (gapToNearestEvent < minGap) {
          minGap = gapToNearestEvent
          bestSlot = {
            scheduled: true,
            startTime: potentialStartTime,
            workload: calculateWorkload(techSchedule, potentialStartTime, potentialEndTime),
          }
        }
      }
    }
  }

  return (
    bestSlot || {
      scheduled: false,
      startTime: null,
      workload: Infinity,
      reason: `No suitable time slot found between ${earliestStart.format('h:mma')} and ${latestEnd.format('h:mma')} within 8-hour work limit`,
    }
  )
}

function findGapToNearestEvent(start, end, schedule) {
  const nearestBefore = schedule
    .filter(e => dayjs(e.end).isBefore(start))
    .reduce((nearest, e) => {
      const gap = start.diff(dayjs(e.end), 'minute')
      return gap < nearest ? gap : nearest
    }, Infinity)

  const nearestAfter = schedule
    .filter(e => dayjs(e.start).isAfter(end))
    .reduce((nearest, e) => {
      const gap = dayjs(e.start).diff(end, 'minute')
      return gap < nearest ? gap : nearest
    }, Infinity)

  return Math.min(nearestBefore, nearestAfter)
}

function scheduleEventWithBacktracking(
  event,
  techSchedules,
  scheduledEventIdsByDate,
  nextGenericTechId,
) {
  const backtrackStack = []
  let attempts = 0

  // Attempting to schedule event with backtracking
  while (attempts < MAX_BACKTRACK_ATTEMPTS) {
    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      // Trying to schedule event with existing tech
      const result = scheduleEventWithRespectToWorkHours(
        event,
        techId,
        techSchedules,
        scheduledEventIdsByDate,
      )
      if (result.scheduled) {
        // Successfully scheduled event with existing tech
        return { scheduled: true, nextGenericTechId }
      }
      else {
        // Failed to schedule event with existing tech
      }
    }

    // If we couldn't schedule with existing techs, create a new one
    const newTechId = `Tech ${getNextAvailableTechId(techSchedules, nextGenericTechId)}`
    techSchedules[newTechId] = [] // Initialize the new tech's schedule
    const result = scheduleEventWithRespectToWorkHours(
      event,
      newTechId,
      techSchedules,
      scheduledEventIdsByDate,
    )
    if (result.scheduled) {
      // Successfully scheduled event with the new tech
      console.log(
        `Scheduled event ${event.id} ${event.company} with new tech ${newTechId}. Reason: ${result.reason}`,
      )
      return { scheduled: true, nextGenericTechId: nextGenericTechId + 1 }
    }

    // Failed to schedule event with the new tech
    console.log(
      `Failed to schedule event ${event.id} ${event.company} with new tech ${newTechId}. Reason: ${result.reason}`,
    )

    // If we still couldn't schedule, backtrack and remove the last event
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
      // Unable to backtrack to remove the last event
      break
    }
  }

  // Failed to schedule event
  console.log(`Failed to schedule event ${event.id} ${event.company} after ${attempts} attempts`)
  return { scheduled: false, nextGenericTechId }
}

function scheduleEventWithRespectToWorkHours(
  event,
  techId,
  techSchedules,
  scheduledEventIdsByDate,
) {
  if (event.time.originalRange.includes('null')) {
    return { scheduled: false, reason: 'Improper time range' }
  }

  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const earliestStart = ensureDayjs(event.start).startOf('day').add(rangeStart, 'second')
  const latestEnd = ensureDayjs(event.start).startOf('day').add(rangeEnd, 'second')

  if (!techSchedules[techId]) {
    techSchedules[techId] = []
  }

  const schedule = techSchedules[techId]
  const gaps = findScheduleGaps(schedule, earliestStart, latestEnd)

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

  return {
    scheduled: false,
    reason: `No available time slot found between ${earliestStart.format('h:mma')} and ${latestEnd.format('h:mma')} on ${earliestStart.format('M/D')} for tech ${techId}`,
  }
}

function isWithinWorkHours(schedule, start, end) {
  const eventStart = ensureDayjs(start)
  const eventEnd = ensureDayjs(end)
  const dayStart = eventStart.startOf('day')
  const nextDayStart = dayStart.add(1, 'day')

  const dayEvents = [
    ...schedule.map(e => ({ start: ensureDayjs(e.start), end: ensureDayjs(e.end) })),
    { start: eventStart, end: eventEnd },
  ].filter(
    e =>
      (e.start.isSameOrAfter(dayStart) && e.start.isBefore(nextDayStart)) ||
      (e.end.isAfter(dayStart) && e.end.isSameOrBefore(nextDayStart)) ||
      (e.start.isBefore(dayStart) && e.end.isAfter(nextDayStart)),
  )

  if (dayEvents.length === 0) {
    return true
  }

  dayEvents.sort((a, b) => a.start.diff(b.start))

  let shiftStart = dayEvents[0].start
  let shiftEnd = dayEvents[0].end

  for (let i = 1; i < dayEvents.length; i++) {
    const currentEvent = dayEvents[i]
    const timeSinceLastEvent = currentEvent.start.diff(shiftEnd, 'hour')

    if (timeSinceLastEvent >= MIN_REST_HOURS) {
      // Check if the previous shift exceeded MAX_SHIFT_DURATION
      if (shiftEnd.diff(shiftStart, 'minute') > MAX_SHIFT_DURATION) {
        return false
      }
      // Start a new shift
      shiftStart = currentEvent.start
    }

    shiftEnd = currentEvent.end
  }

  // Check the final shift duration
  const finalShiftDuration = shiftEnd.diff(shiftStart, 'minute')
  return finalShiftDuration <= MAX_SHIFT_DURATION
}

function calculateShiftDuration(events) {
  if (events.length === 0) return 0

  const shiftStart = ensureDayjs(events[0].start)
  const shiftEnd = ensureDayjs(events[events.length - 1].end)

  return shiftEnd.diff(shiftStart, 'minute')
}

function isIsolatedEvent(events, index) {
  const event = events[index]
  const prevEvent = index > 0 ? events[index - 1] : null
  const nextEvent = index < events.length - 1 ? events[index + 1] : null

  const gapBefore = prevEvent
    ? ensureDayjs(event.start).diff(ensureDayjs(prevEvent.end), 'minute')
    : Infinity
  const gapAfter = nextEvent
    ? ensureDayjs(nextEvent.start).diff(ensureDayjs(event.end), 'minute')
    : Infinity

  return gapBefore > MAX_GAP_BETWEEN_EVENTS && gapAfter > MAX_GAP_BETWEEN_EVENTS
}

function findBestStartTimeInGap(gap, duration, schedule) {
  const gapStart = gap.start
  const gapEnd = gap.end.subtract(duration, 'minute')

  if (gapEnd.isBefore(gapStart)) {
    return gapStart
  }

  const nearestEvent = findNearestEvent(gap, schedule)

  if (!nearestEvent) {
    return gapStart
  }

  if (nearestEvent.end.isBefore(gap.start)) {
    return gapStart
  }

  if (nearestEvent.start.isAfter(gap.end)) {
    return gapEnd
  }

  // Try to schedule as close as possible to the nearest event
  if (nearestEvent.end.isBefore(gapStart)) {
    return gapStart
  }
  else if (nearestEvent.start.isAfter(gapEnd)) {
    return gapEnd
  }
  else {
    const middleOfGap = gapStart.add(gapEnd.diff(gapStart) / 2, 'minute')
    return middleOfGap
  }
}

function findNearestEvent(gap, schedule) {
  return schedule.reduce((nearest, event) => {
    const eventStart = ensureDayjs(event.start)
    const eventEnd = ensureDayjs(event.end)
    const distanceToStart = Math.abs(gap.start.diff(eventStart, 'minute'))
    const distanceToEnd = Math.abs(gap.start.diff(eventEnd, 'minute'))
    const distance = Math.min(distanceToStart, distanceToEnd)

    if (!nearest || distance < nearest.distance) {
      return { start: eventStart, end: eventEnd, distance }
    }
    return nearest
  }, null)
}

function findScheduleGaps(schedule, start, end) {
  const gaps = []
  let currentTime = ensureDayjs(start)
  const endTime = ensureDayjs(end)

  schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

  let lastEventEnd = null

  schedule.forEach(event => {
    const eventStart = ensureDayjs(event.start)
    const eventEnd = ensureDayjs(event.end)

    if (lastEventEnd && eventStart.diff(lastEventEnd, 'hour') >= MIN_REST_HOURS) {
      // Add a gap that respects the minimum rest period
      gaps.push({ start: lastEventEnd.add(MIN_REST_HOURS, 'hour'), end: eventStart })
    }
    else if (eventStart.isAfter(currentTime)) {
      gaps.push({ start: currentTime, end: eventStart })
    }

    currentTime = dayjs.max(currentTime, eventEnd)
    lastEventEnd = eventEnd
  })

  if (endTime.isAfter(currentTime)) {
    if (lastEventEnd && endTime.diff(lastEventEnd, 'hour') >= MIN_REST_HOURS) {
      // Add a final gap that respects the minimum rest period
      gaps.push({ start: lastEventEnd.add(MIN_REST_HOURS, 'hour'), end: endTime })
    }
    else {
      gaps.push({ start: currentTime, end: endTime })
    }
  }

  return gaps
}

function addEvent(schedule, event) {
  const index = schedule.findIndex(e => ensureDayjs(e.start).isAfter(ensureDayjs(event.start)))
  if (index === -1) {
    schedule.push(event)
  }
  else {
    schedule.splice(index, 0, event)
  }
}

function removeEventFromSchedule(event, techId, techSchedules, scheduledEventIdsByDate) {
  techSchedules[techId] = techSchedules[techId].filter(e => e.id !== event.id)
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

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    let techSummary = `${techId}:\n`

    // Group events by day
    const daySchedules = new Map()
    schedule.forEach(event => {
      const day = ensureDayjs(event.start).startOf('day').format('YYYY-MM-DD')
      if (!daySchedules.has(day)) {
        daySchedules.set(day, [])
      }
      daySchedules.get(day).push(event)
    })

    // Print events and calculate shift duration for each day
    for (const [day, events] of daySchedules) {
      events.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

      events.forEach(event => {
        const date = ensureDayjs(event.start).format('M/D')
        const start = ensureDayjs(event.start).format('h:mma')
        const end = ensureDayjs(event.end).format('h:mma')
        techSummary += `- ${date}, ${start}-${end}, ${event.company} (id: ${event.id})\n`
      })

      const shiftDuration = calculateShiftDuration(events)
      const shiftDurationHours = (shiftDuration / 60).toFixed(1)
      techSummary += `Shift duration: ${shiftDurationHours} hours\n\n`
    }

    if (schedule.length > 0) {
      scheduleSummary += techSummary
    }
  })

  // Unallocated events
  if (unscheduledEvents.length > 0) {
    scheduleSummary += 'Unallocated services:\n'
    unscheduledEvents.forEach(event => {
      const date = ensureDayjs(event.start).format('M/D')
      const timeWindow = formatTimeRange(event.time.range[0], event.time.range[1])
      scheduleSummary += `- ${date}, ${timeWindow} time window, ${event.company} (id: ${event.id}), Reason: ${event.reason}\n`
    })

    // Log events with time range issues
    const reasonToFilter = 'time range'
    const eventsWithTimeIssues = [
      ...new Set(
        unscheduledEvents
          .filter(e => e.reason.includes(reasonToFilter))
          .map(e => ({
            id: e.id.split('-')[0],
            reason: e.reason,
          })),
      ),
    ]
    if (eventsWithTimeIssues.length > 0) {
      scheduleSummary += `\nUnscheduled due to ${reasonToFilter} issues (${eventsWithTimeIssues.length}): ${eventsWithTimeIssues.map(e => e.id).join(', ')}`
      for (const event of eventsWithTimeIssues) {
        scheduleSummary += `\n- ${event.id}: ${event.reason}`
      }
    }
  }

  console.log(scheduleSummary)
}
