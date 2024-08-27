// /src/app/utils/scheduleSummary.js

import { dayjsInstance as dayjs } from './dayjs'

/**
 * Adds an event to the schedule summary.
 *
 * @param {Object} scheduleSummary - The current schedule summary object.
 * @param {Object} event - The event to add to the summary.
 */
export function addToScheduleSummary(scheduleSummary, event) {
  const resourceName = event.resourceId
  const startTime = dayjs(event.start).format('h:mma')
  const endTime = dayjs(event.end).format('h:mma')

  if (!scheduleSummary[resourceName]) {
    scheduleSummary[resourceName] = []
  }

  scheduleSummary[resourceName].push(`${event.title} is at ${startTime}-${endTime}`)
}

/**
 * Generates a textual summary of the schedule.
 *
 * @param {Object} scheduleSummary - The schedule summary object.
 * @returns {string} A formatted string representing the schedule summary.
 */
export function generateScheduleSummaryText(scheduleSummary) {
  let summaryText = ''

  for (const [resourceName, events] of Object.entries(scheduleSummary)) {
    summaryText += `${resourceName}:\n`
    if (Array.isArray(events)) {
      events.forEach((event, index) => {
        summaryText += `  ${index + 1}. ${event}\n`
      })
    } else if (typeof events === 'object' && events !== null) {
      // Handle the case where events is an object
      if ('totalHours' in events) {
        summaryText += `  Total Hours: ${Number(events.totalHours).toFixed(2)}\n`
      }
      if ('eventCount' in events) {
        summaryText += `  Event Count: ${events.eventCount}\n`
      }
      if (!('totalHours' in events) && !('eventCount' in events)) {
        summaryText += `  Event details not available\n`
      }
    } else {
      summaryText += `  No events data available\n`
    }
    summaryText += '\n'
  }

  return summaryText.trim()
}

/**
 * Calculates the total scheduled time for each resource.
 *
 * @param {Array} allocatedEvents - The list of allocated events.
 * @returns {Object} An object with resource IDs as keys and total scheduled time in minutes as values.
 */
export function calculateResourceUtilization(allocatedEvents) {
  const utilization = {}

  allocatedEvents.forEach((event) => {
    const resourceId = event.resourceId
    const duration = dayjs(event.end).diff(dayjs(event.start), 'minute')

    if (!utilization[resourceId]) {
      utilization[resourceId] = 0
    }

    utilization[resourceId] += duration
  })

  return utilization
}

/**
 * Identifies gaps in the schedule for each resource.
 *
 * @param {Array} allocatedEvents - The list of allocated events.
 * @param {Date} dayStart - The start of the scheduling day.
 * @param {Date} dayEnd - The end of the scheduling day.
 * @returns {Object} An object with resource IDs as keys and arrays of gap periods as values.
 */
export function findScheduleGaps(allocatedEvents, dayStart, dayEnd) {
  const gaps = {}

  // Group events by resource
  const eventsByResource = allocatedEvents.reduce((acc, event) => {
    if (!acc[event.resourceId]) {
      acc[event.resourceId] = []
    }
    acc[event.resourceId].push(event)
    return acc
  }, {})

  // Find gaps for each resource
  for (const [resourceId, events] of Object.entries(eventsByResource)) {
    gaps[resourceId] = []
    events.sort((a, b) => a.start - b.start)

    let lastEndTime = dayStart

    events.forEach((event) => {
      if (event.start > lastEndTime) {
        gaps[resourceId].push({
          start: lastEndTime,
          end: event.start,
        })
      }
      lastEndTime = event.end > lastEndTime ? event.end : lastEndTime
    })

    if (lastEndTime < dayEnd) {
      gaps[resourceId].push({
        start: lastEndTime,
        end: dayEnd,
      })
    }
  }

  return gaps
}
