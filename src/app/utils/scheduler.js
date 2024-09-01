// leaves none, space on 2 and 4

import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_WORK_HOURS = 8 * 60 * 60 // 8 hours in seconds
const TIME_INCREMENT = 15 * 60 // 15 minutes in seconds

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
      // Try to schedule with existing techs
      for (const techId in techSchedules) {
        if (
          scheduleEventWithRespectToWorkHours(event, techId, techSchedules, scheduledEventIdsByDate)
        ) {
          scheduled = true
          break
        }
      }

      // If not scheduled, create a new tech
      if (!scheduled) {
        const newTechId = `Tech ${nextGenericTechId++}`
        techSchedules[newTechId] = []
        scheduled = scheduleEventWithRespectToWorkHours(
          event,
          newTechId,
          techSchedules,
          scheduledEventIdsByDate,
        )
      }
    }

    if (!scheduled) {
      unscheduledEvents.push(event)
    }
  })
  console.timeEnd('Scheduling events')

  // Try to optimize schedule and fit unscheduled events
  console.time('Optimizing schedule')
  optimizeSchedule(techSchedules, unscheduledEvents, scheduledEventIdsByDate)
  console.timeEnd('Optimizing schedule')

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: event.start.toDate(),
      end: event.end.toDate(),
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

  return { scheduledEvents, unscheduledEvents, scheduleSummary }
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
  const startTime = dayjs(event.start).startOf('day').add(rangeStart, 'second')
  const endTime = dayjs(event.start).startOf('day').add(rangeEnd, 'second')
  const duration = event.time.duration * 60

  if (!techSchedules[techId]) techSchedules[techId] = []

  const schedule = techSchedules[techId]
  let potentialStart = startTime

  while (potentialStart.add(duration, 'second').isSameOrBefore(endTime)) {
    const potentialEnd = potentialStart.add(duration, 'second')

    if (!isOverlapping(schedule, potentialStart, potentialEnd)) {
      if (isWithinWorkHours(schedule, potentialStart, potentialEnd)) {
        techSchedules[techId].push({
          ...event,
          start: potentialStart,
          end: potentialEnd,
        })

        const eventDate = potentialStart.format('YYYY-MM-DD')
        const eventKey = `${event.id}-${eventDate}`
        scheduledEventIdsByDate.set(eventKey, techId)

        return true
      } else {
        return false
      }
    }

    potentialStart = potentialStart.add(TIME_INCREMENT, 'second')
  }

  return false
}

function optimizeSchedule(techSchedules, unscheduledEvents, scheduledEventIdsByDate) {
  let changed = true
  while (changed) {
    changed = false

    // Sort techs by total scheduled time (ascending)
    const sortedTechs = Object.keys(techSchedules).sort((a, b) => {
      return getTotalScheduledTime(techSchedules[a]) - getTotalScheduledTime(techSchedules[b])
    })

    // Try to move events from more occupied techs to less occupied ones
    for (let i = sortedTechs.length - 1; i > 0; i--) {
      const sourceTechId = sortedTechs[i]
      const sourceSchedule = techSchedules[sourceTechId]

      for (let j = 0; j < i; j++) {
        const targetTechId = sortedTechs[j]
        const targetSchedule = techSchedules[targetTechId]

        for (const event of sourceSchedule) {
          if (
            tryMoveEvent(event, sourceTechId, targetTechId, techSchedules, scheduledEventIdsByDate)
          ) {
            changed = true
            break
          }
        }
        if (changed) break
      }
      if (changed) break
    }

    // Try to schedule unscheduled events
    if (!changed) {
      for (const event of unscheduledEvents) {
        for (const techId of sortedTechs) {
          if (
            scheduleEventWithRespectToWorkHours(
              event,
              techId,
              techSchedules,
              scheduledEventIdsByDate,
            )
          ) {
            unscheduledEvents = unscheduledEvents.filter((e) => e.id !== event.id)
            changed = true
            break
          }
        }
        if (changed) break
      }
    }

    // If still not changed, try to move events to create space for unscheduled events
    if (!changed && unscheduledEvents.length > 0) {
      changed = tryCreateSpaceForUnscheduledEvents(
        unscheduledEvents,
        techSchedules,
        scheduledEventIdsByDate,
      )
    }
  }

  // Add reasons for unscheduled events
  unscheduledEvents.forEach((event) => {
    event.reason = 'Could not find a suitable time slot within work hours'
  })
}

function tryMoveEvent(event, sourceTechId, targetTechId, techSchedules, scheduledEventIdsByDate) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    event.time.originalRange,
    event.time.duration,
  )
  const earliestStart = dayjs(event.start).startOf('day').add(rangeStart, 'second')
  const latestStart = dayjs(event.start)
    .startOf('day')
    .add(rangeEnd, 'second')
    .subtract(event.time.duration, 'minute')

  const targetSchedule = techSchedules[targetTechId]
  let potentialStart = earliestStart

  while (potentialStart.isSameOrBefore(latestStart)) {
    const potentialEnd = potentialStart.add(event.time.duration, 'minute')

    if (
      !isOverlapping(targetSchedule, potentialStart, potentialEnd) &&
      isWithinWorkHours(targetSchedule, potentialStart, potentialEnd)
    ) {
      // Move the event
      techSchedules[sourceTechId] = techSchedules[sourceTechId].filter((e) => e.id !== event.id)
      event.start = potentialStart
      event.end = potentialEnd
      targetSchedule.push(event)

      const eventDate = event.start.format('YYYY-MM-DD')
      const eventKey = `${event.id}-${eventDate}`
      scheduledEventIdsByDate.set(eventKey, targetTechId)

      return true
    }

    potentialStart = potentialStart.add(TIME_INCREMENT, 'second')
  }

  return false
}

function tryCreateSpaceForUnscheduledEvents(
  unscheduledEvents,
  techSchedules,
  scheduledEventIdsByDate,
) {
  for (const event of unscheduledEvents) {
    const [rangeStart, rangeEnd] = memoizedParseTimeRange(
      event.time.originalRange,
      event.time.duration,
    )
    const earliestStart = dayjs(event.start).startOf('day').add(rangeStart, 'second')
    const latestStart = dayjs(event.start)
      .startOf('day')
      .add(rangeEnd, 'second')
      .subtract(event.time.duration, 'minute')

    for (const techId in techSchedules) {
      const schedule = techSchedules[techId]
      const conflictingEvents = schedule.filter(
        (e) =>
          (e.start.isBefore(latestStart) && e.end.isAfter(earliestStart)) ||
          (e.start.isSame(earliestStart) && e.end.isSame(latestStart)),
      )

      for (const conflictingEvent of conflictingEvents) {
        for (const otherTechId in techSchedules) {
          if (otherTechId !== techId) {
            if (
              tryMoveEvent(
                conflictingEvent,
                techId,
                otherTechId,
                techSchedules,
                scheduledEventIdsByDate,
              )
            ) {
              if (
                scheduleEventWithRespectToWorkHours(
                  event,
                  techId,
                  techSchedules,
                  scheduledEventIdsByDate,
                )
              ) {
                unscheduledEvents = unscheduledEvents.filter((e) => e.id !== event.id)
                return true
              }
            }
          }
        }
      }
    }
  }
  return false
}

function getTotalScheduledTime(schedule) {
  return schedule.reduce((total, event) => total + event.time.duration, 0)
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

function isOverlapping(schedule, start, end) {
  return schedule.some(
    (existingEvent) =>
      (start.isBefore(existingEvent.end) && end.isAfter(existingEvent.start)) ||
      start.isSame(existingEvent.start),
  )
}

function isWithinWorkHours(schedule, start, end) {
  const dayEvents = [
    ...schedule,
    {
      start,
      end,
    },
  ].filter((e) => e.start.isSame(start, 'day'))
  dayEvents.sort((a, b) => a.start - b.start)
  const totalDuration = dayEvents[dayEvents.length - 1].end.diff(dayEvents[0].start, 'second')
  return totalDuration <= MAX_WORK_HOURS
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
      const timeWindow = formatTimeRange(event.time.range[0], event.time.range[1])
      scheduleSummary += `- ${timeWindow} time window, ${event.company} (id: ${event.id})`
      if (event.reason) {
        scheduleSummary += ` (Reason: ${event.reason})`
      }
      scheduleSummary += '\n'
    })
    hasPrintedEvents = true
  }

  return hasPrintedEvents ? scheduleSummary : ''
}
