// /src/app/utils/eventGeneration.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTime, parseTimeRange } from '@/app/utils/timeRange'

export function generateEventsForDateRange(setup, startDate, endDate) {
  const events = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

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
    }
  }

  return events
}

function shouldEventOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  return scheduleString.charAt(dayOfYear) === '1'
}
