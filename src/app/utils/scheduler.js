import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'
import { memoize } from 'lodash'

const MAX_WORK_HOURS = 8 * 60 // 8 hours in minutes
const TIME_INCREMENT = 15 * 60 // 15 minutes in seconds
const MAX_BACKTRACK_ATTEMPTS = 5
const REST_PERIOD = 0

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

function ensureDate(date) {
  return dayjs.isDayjs(date) ? date.toDate() : date
}

function findValidShift(events) {
  let shiftStart = null
  let shiftEnd = null
  let shiftDuration = 0
  let validEvents = []

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const [rangeStart, rangeEnd] = memoizedParseTimeRange(
      event.time.originalRange,
      event.time.duration,
    )
    const eventStart = dayjs(event.start).startOf('day').add(rangeStart, 'second')
    const eventEnd = eventStart.add(event.time.duration, 'minute')
    const eventDuration = event.time.duration

    if (!shiftStart) {
      shiftStart = eventStart
      shiftEnd = eventEnd
      shiftDuration = eventDuration
      validEvents.push({ ...event, start: eventStart.toDate(), end: eventEnd.toDate() })
    } else {
      const gapDuration = eventStart.diff(shiftEnd, 'minute')

      if (gapDuration >= REST_PERIOD) {
        // If there's a 16+ hour gap, start a new shift
        return {
          validEvents: validEvents,
          remainingEvents: events.slice(i),
        }
      } else if (shiftDuration + eventDuration <= MAX_WORK_HOURS) {
        // If adding this event doesn't exceed 8 hours, include it
        shiftEnd = eventEnd
        shiftDuration += eventDuration
        validEvents.push({ ...event, start: eventStart.toDate(), end: eventEnd.toDate() })
      } else {
        // If adding this event would exceed 8 hours, end the shift here
        return {
          validEvents: validEvents,
          remainingEvents: events.slice(i),
        }
      }
    }
  }

  // If we've gone through all events without exceeding 8 hours
  return {
    validEvents: validEvents,
    remainingEvents: [],
  }
}

const memoizedCheckWorkHours = memoize(
  (techSchedule, startTime, duration) => {
    const endTime = startTime.add(duration, 'minute')
    const windowStart = startTime.subtract(24, 'hour')

    const relevantEvents = [
      ...techSchedule.filter(
        (e) => dayjs(e.end).isAfter(windowStart) && dayjs(e.start).isBefore(endTime),
      ),
      { start: startTime.toISOString(), end: endTime.toISOString() },
    ].sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

    let workingTime = 0
    let restStart = windowStart

    for (const event of relevantEvents) {
      const eventStart = dayjs(event.start)
      const eventEnd = dayjs(event.end)

      // Reset work time if there's been a 16-hour break
      if (eventStart.diff(restStart, 'hour') >= 16) {
        workingTime = 0
      }

      workingTime += eventEnd.diff(eventStart, 'minute')

      // Check if we've exceeded 8 hours in the last 24 hours
      if (workingTime > MAX_WORK_HOURS) {
        return false
      }

      restStart = eventEnd
    }

    return true
  },
  (techSchedule, startTime, duration) => {
    const scheduleKey = techSchedule.map((e) => `${e.id}-${e.start}-${e.end}`).join(',')
    return `${scheduleKey}-${startTime.format('YYYY-MM-DD HH:mm')}-${duration}`
  },
)

function findBestSlotForEvent(event, techId, techSchedules) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const earliestStart = dayjs(event.start).startOf('day').add(rangeStart, 'second')
  const latestStart = dayjs(event.start)
    .startOf('day')
    .add(rangeEnd, 'second')
    .subtract(event.time.duration, 'minute')

  const techSchedule = techSchedules[techId] || []
  const gaps = findScheduleGaps(techSchedule, earliestStart, latestStart)

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      for (
        let potentialStartTime = gap.start;
        potentialStartTime.add(event.time.duration, 'minute').isSameOrBefore(gap.end);
        potentialStartTime = potentialStartTime.add(TIME_INCREMENT, 'second')
      ) {
        if (memoizedCheckWorkHours(techSchedule, potentialStartTime, event.time.duration)) {
          const eventEnd = potentialStartTime.add(event.time.duration, 'minute')
          return {
            scheduled: true,
            startTime: potentialStartTime,
            endTime: eventEnd,
          }
        }
      }
    }
  }

  return {
    scheduled: false,
    startTime: null,
    reason: `No suitable time slot found between ${earliestStart.format('HH:mm')} and ${latestStart.format('HH:mm')} within 8-hour work limit`,
  }
}

export function scheduleEvents({ events, visibleStart, visibleEnd }) {
  console.time('Total scheduling time')
  console.log(`Starting scheduling process with ${events.length} events`)

  let techSchedules = {}
  let nextGenericTechId = 1
  let unscheduledEvents = []
  const scheduledEventIdsByDate = new Map()

  // Sort events by start time
  events.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  // First pass: Schedule events respecting 8-hour shifts
  events.forEach((event) => {
    let scheduled = false
    if (event.tech.enforced) {
      scheduled = scheduleEnforcedEvent(event, techSchedules, scheduledEventIdsByDate)
    } else {
      for (const techId in techSchedules) {
        const result = findBestSlotForEvent(event, techId, techSchedules)
        if (result.scheduled) {
          const startTime = result.startTime
          const endTime = result.endTime
          const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
          addEvent(techSchedules[techId], scheduledEvent)

          const eventDate = startTime.format('YYYY-MM-DD')
          const eventKey = `${event.id}-${eventDate}`
          scheduledEventIdsByDate.set(eventKey, techId)
          scheduled = true
          break
        }
      }

      if (!scheduled) {
        const newTechId = `Tech ${nextGenericTechId++}`
        techSchedules[newTechId] = []
        const result = findBestSlotForEvent(event, newTechId, techSchedules)
        if (result.scheduled) {
          const startTime = result.startTime
          const endTime = result.endTime
          const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
          addEvent(techSchedules[newTechId], scheduledEvent)

          const eventDate = startTime.format('YYYY-MM-DD')
          const eventKey = `${event.id}-${eventDate}`
          scheduledEventIdsByDate.set(eventKey, newTechId)
          scheduled = true
        }
      }
    }

    if (!scheduled) {
      unscheduledEvents.push(event)
    }
  })

  // Second pass: Try to schedule unscheduled events
  unscheduledEvents = tryScheduleUnscheduledEvents(
    unscheduledEvents,
    techSchedules,
    scheduledEventIdsByDate,
    nextGenericTechId,
  )

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      resourceId: techId,
    })),
  )

  console.timeEnd('Total scheduling time')

  printSummary(techSchedules, unscheduledEvents)

  return {
    scheduledEvents,
    unscheduledEvents,
  }
}

function tryScheduleUnscheduledEvents(
  unscheduledEvents,
  techSchedules,
  scheduledEventIdsByDate,
  nextGenericTechId,
) {
  const remainingUnscheduled = []
  for (const event of unscheduledEvents) {
    let scheduled = false
    let reason = ''

    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      const result = findBestSlotForEvent(event, techId, techSchedules)
      if (result.scheduled) {
        scheduled = true
        const startTime = result.startTime
        const endTime = result.endTime
        const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
        addEvent(techSchedules[techId], scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, techId)
        break
      } else {
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
        const endTime = result.endTime
        const scheduledEvent = { ...event, start: startTime.toDate(), end: endTime.toDate() }
        addEvent(techSchedules[newTechId], scheduledEvent)

        const eventDate = startTime.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, newTechId)
        scheduled = true
      } else {
        reason = result.reason
      }
    }

    if (!scheduled) {
      event.reason = reason
      remainingUnscheduled.push(event)
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

function renameGenericResources(techSchedules) {
  const genericTechs = Object.keys(techSchedules).filter((id) => id.startsWith('Tech '))
  genericTechs.sort((a, b) => {
    const aNum = parseInt(a.split(' ')[1])
    const bNum = parseInt(b.split(' ')[1])
    return aNum - bNum
  })

  genericTechs.forEach((oldId, index) => {
    const newId = `Tech ${index + 1}`
    if (oldId !== newId) {
      techSchedules[newId] = techSchedules[oldId]
      delete techSchedules[oldId]
    }
  })
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
