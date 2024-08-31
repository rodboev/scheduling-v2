// /src/utils/eventGeneration.js

import { dayjsInstance as dayjs } from '@/utils/dayjs'
import { parseTime, parseTimeRange } from '@/utils/timeRange'

export function generateEventsForDateRange(setup, startDate, endDate) {
  const events = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  // console.log(`Generating events for setup ${setup.id} from ${start.format()} to ${end.format()}`)

  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    if (shouldEventOccur(setup.schedule.string, date)) {
      const baseEvent = {
        ...setup,
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        date: date.toDate(),
      }

      if (setup.time.enforced) {
        events.push({
          ...baseEvent,
          start: date.add(parseTime(setup.time.preferred), 'second').toDate(),
          end: date
            .add(parseTime(setup.time.preferred) + setup.time.duration * 60, 'second')
            .toDate(),
        })
      } else {
        const [rangeStart, rangeEnd] = parseTimeRange(setup.time.originalRange, setup.time.duration)
        events.push({
          ...baseEvent,
          start: date.add(rangeStart, 'second').toDate(),
          end: date.add(rangeEnd, 'second').toDate(),
        })
      }

      // Ensure the tech.enforced property is carried over
      events[events.length - 1].tech.enforced = setup.tech.enforced
    }
  }

  // console.log(`Generated ${events.length} events for setup ${setup.id}`)
  return events.map((event) => {
    let eventEnd = dayjs(event.end)
    if (eventEnd.isBefore(event.start)) {
      // If the end time is before the start time, it means the event spans past midnight
      eventEnd = eventEnd.add(1, 'day')
    }
    return {
      ...event,
      end: eventEnd.toDate(),
    }
  })
}

function shouldEventOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  const scheduleIndex = dayOfYear
  const shouldOccur = scheduleString[scheduleIndex] === '1'
  // console.log(
  //   `Date: ${date.format('YYYY-MM-DD')}, Day of year: ${dayOfYear}, Schedule value: ${scheduleString[scheduleIndex]}, Should occur: ${shouldOccur}`,
  // )
  return shouldOccur
}
