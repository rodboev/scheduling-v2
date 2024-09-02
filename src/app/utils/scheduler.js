import { dayjsInstance as dayjs } from './dayjs'
import PriorityQueue from 'priorityqueuejs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 // 8 hours in minutes
const TIME_INCREMENT = 15 * 60 // 15 minutes in seconds
const MAX_BACKTRACK_ATTEMPTS = 5

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

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

  // Try to schedule unscheduled events one more time
  unscheduledEvents = tryScheduleUnscheduledEvents(
    unscheduledEvents,
    techSchedules,
    scheduledEventIdsByDate,
  )

  console.timeEnd('Scheduling events')

  // Rename generic resources
  renameGenericResources(techSchedules)

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

function tryScheduleUnscheduledEvents(unscheduledEvents, techSchedules, scheduledEventIdsByDate) {
  console.log('Attempting to schedule unscheduled events:', unscheduledEvents.length)
  const remainingUnscheduled = []
  for (const event of unscheduledEvents) {
    console.log(`\nTrying to schedule event: ${event.id} - ${event.company}`)
    console.log(
      `Event time window: ${event.time.originalRange}, Duration: ${event.time.duration} minutes`,
    )
    let scheduled = false
    let bestTechId = null
    let bestStartTime = null
    let minWorkload = Infinity

    for (const techId in techSchedules) {
      console.log(`\nChecking Tech ${techId}:`)
      const result = findBestSlotForEvent(event, techId, techSchedules)
      console.log(`Result for Tech ${techId}:`, result)
      if (result.scheduled && result.workload < minWorkload) {
        scheduled = true
        bestTechId = techId
        bestStartTime = result.startTime
        minWorkload = result.workload
        console.log(`Found better slot with Tech ${techId} at ${bestStartTime.format('HH:mm')}`)
      }
    }

    if (scheduled) {
      const endTime = bestStartTime.add(event.time.duration, 'minute')
      const scheduledEvent = { ...event, start: bestStartTime.toDate(), end: endTime.toDate() }
      addEvent(techSchedules[bestTechId], scheduledEvent)

      const eventDate = bestStartTime.format('YYYY-MM-DD')
      const eventKey = `${event.id}-${eventDate}`
      scheduledEventIdsByDate.set(eventKey, bestTechId)
      console.log(
        `Successfully scheduled event ${event.id} with Tech ${bestTechId} from ${bestStartTime.format('HH:mm')} to ${endTime.format('HH:mm')}`,
      )
    } else {
      event.reason = `Unallocated: ${event.reason || 'No suitable time slot found across all techs'}`
      remainingUnscheduled.push(event)
      console.log(`Failed to schedule event ${event.id}. Reason: ${event.reason}`)
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
  ].filter((e) => e.start.isSame(dayjs(start), 'day'))

  console.log(
    `Day events for Tech on ${dayjs(start).format('YYYY-MM-DD')}:`,
    dayEvents.map((e) => `${e.start.format('HH:mm')}-${e.end.format('HH:mm')}`),
  )

  if (dayEvents.length === 0) {
    console.log('No events for this day, considering it within work hours')
    return true
  }

  dayEvents.sort((a, b) => a.start.diff(b.start))
  const totalDuration = dayEvents[dayEvents.length - 1].end.diff(dayEvents[0].start, 'minute')

  console.log(`Total work duration: ${totalDuration / 60} hours`)
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

  console.log(
    `Earliest start: ${earliestStart.format('HH:mm')}, Latest end: ${latestEnd.format('HH:mm')}`,
  )

  const techSchedule = techSchedules[techId] || []
  console.log(
    `Current schedule for Tech ${techId}:`,
    techSchedule.map((e) => `${dayjs(e.start).format('HH:mm')}-${dayjs(e.end).format('HH:mm')}`),
  )

  const gaps = findScheduleGaps(techSchedule, earliestStart, latestEnd)
  console.log(
    `Found gaps:`,
    gaps.map((gap) => `${gap.start.format('HH:mm')}-${gap.end.format('HH:mm')}`),
  )

  let bestStartTime = null
  let minWorkload = Infinity
  let reason = ''

  for (const gap of gaps) {
    console.log(`Checking gap: ${gap.start.format('HH:mm')}-${gap.end.format('HH:mm')}`)
    if (gap.end.diff(gap.start, 'minute') >= event.time.duration) {
      const startTime = gap.start
      const endTime = startTime.add(event.time.duration, 'minute')
      if (endTime.isAfter(latestEnd)) {
        console.log(`Event would end after the latest allowed end time`)
        continue
      }
      console.log(`Potential slot: ${startTime.format('HH:mm')}-${endTime.format('HH:mm')}`)

      if (isWithinWorkHours(techSchedule, startTime, endTime)) {
        const workload = calculateWorkload(techSchedule, startTime, endTime)
        console.log(`Slot is within work hours. Workload: ${workload / 60} hours`)
        if (workload < minWorkload) {
          bestStartTime = startTime
          minWorkload = workload
          console.log(`New best start time: ${bestStartTime.format('HH:mm')}`)
        }
      } else {
        console.log(`Slot exceeds work hours limit`)
        reason = 'Exceeds work hours limit'
      }
    } else {
      console.log(`Gap is too small for event duration`)
      reason = 'No gap large enough for event duration'
    }
  }

  return {
    scheduled: bestStartTime !== null,
    startTime: bestStartTime,
    workload: minWorkload,
    reason: bestStartTime ? '' : reason,
  }
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
