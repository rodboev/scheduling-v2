// /src/app/utils/eventGeneration.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTime, parseTimeRange } from '@/app/utils/timeRange'

export function generateEventsForYear(setup, year) {
  const events = []
  const startDate = dayjs(`${year}-01-01`)
  const endDate = dayjs(`${year}-12-31`)

  for (let date = startDate; date.isSameOrBefore(endDate); date = date.add(1, 'day')) {
    if (shouldEventOccur(setup.schedule.schedule, date)) {
      const baseEvent = {
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        setupId: setup.id,
        title: setup.company,
        tech: {
          ...setup.tech,
          enforced: setup.tech.enforced,
        },
        time: {
          ...setup.time,
          originalRange: setup.time.originalRange,
        },
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
