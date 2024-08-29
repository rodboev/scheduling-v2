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

  // Function to attempt scheduling an event
  const attemptSchedule = (event) => {
    if (event.tech.enforced) {
      return scheduleEventWithRespectToWorkHours(
        event,
        event.tech.code,
        techSchedules,
        scheduledEventIdsByDate,
      )
    }

    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      if (
        scheduleEventWithRespectToWorkHours(event, techId, techSchedules, scheduledEventIdsByDate)
      ) {
        return true
      }
    }

    // If not scheduled, create a new tech and try again
    const newTechId = `Tech ${nextTechId++}`
    techSchedules[newTechId] = []
    return scheduleEventWithRespectToWorkHours(
      event,
      newTechId,
      techSchedules,
      scheduledEventIdsByDate,
    )
  }

  // Schedule all events
  events.forEach(attemptSchedule)

  // Check for any remaining unallocated events
  let unallocatedEvents = events.filter((event) => {
    const eventDate = dayjs(event.start).startOf('day').format('YYYY-MM-DD')
    const eventKey = `${event.id}-${eventDate}`
    return !scheduledEventIdsByDate.has(eventKey)
  })

  // Attempt to schedule unallocated events
  while (unallocatedEvents.length > 0) {
    const initialUnallocatedCount = unallocatedEvents.length
    unallocatedEvents = unallocatedEvents.filter((event) => !attemptSchedule(event))

    // If we couldn't schedule any more events, break to avoid an infinite loop
    if (unallocatedEvents.length === initialUnallocatedCount) {
      console.warn(`Unable to schedule ${unallocatedEvents.length} events:`, unallocatedEvents)
      break
    }
  }

  // Convert techSchedules to scheduledEvents format
  const scheduledEvents = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map((event) => ({
      ...event,
      start: event.start.toDate(),
      end: event.end.toDate(),
      resourceId: techId,
    })),
  )

  const scheduleSummary = createScheduleSummary(techSchedules, unallocatedEvents)

  console.log(`Total scheduled events: ${scheduledEvents.length}`)
  console.log(`Total unallocated events: ${unallocatedEvents.length}`)
  console.log(`Total techs used: ${Object.keys(techSchedules).length}`)

  return { scheduledEvents, unscheduledEvents: unallocatedEvents, scheduleSummary }
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
    let [rangeStart, rangeEnd] = parseTimeRange(event.time.originalRange, event.time.duration)
    if (isNaN(rangeStart) || isNaN(rangeEnd) || rangeEnd <= rangeStart) {
      // Handle invalid time ranges
      rangeStart = 0 // Start of day
      rangeEnd = 24 * 60 * 60 - 1 // End of day
    }
    const startTime = dayjs(event.start).startOf('day').add(rangeStart, 'second')
    const endTime = dayjs(event.start).startOf('day').add(rangeEnd, 'second')
    const duration = event.time.duration * 60 // duration in seconds

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

    if (
      !schedule.some(
        (existingEvent) =>
          (potentialStart.isBefore(existingEvent.end) &&
            potentialEnd.isAfter(existingEvent.start)) ||
          potentialStart.isSame(existingEvent.start),
      )
    ) {
      const dayStart = potentialStart.startOf('day')
      const dayEvents = schedule.filter((slot) => dayjs(slot.start).isSame(dayStart, 'day'))
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

// Modify tryScheduleEvent to always schedule the event, even if it exceeds MAX_WORK_HOURS
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
      techSchedules[techId].push({
        ...event,
        start: potentialStart,
        end: potentialEnd,
      })
      return true
    }

    potentialStart = potentialStart.add(1, 'minute')
  }

  // If we couldn't find a slot, schedule it at the original start time anyway
  techSchedules[techId].push({
    ...event,
    start: startTime,
    end: startTime.add(duration, 'second'),
  })
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
