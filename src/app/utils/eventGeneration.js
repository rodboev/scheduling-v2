// /src/app/utils/eventGeneration.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTime } from '@/app/utils/timeRange'

export function generateEventsForYear(setup, year) {
  const events = []
  const startDate = dayjs(`${year}-01-01`)
  const endDate = dayjs(`${year}-12-31`)

  for (let date = startDate; date.isSameOrBefore(endDate); date = date.add(1, 'day')) {
    if (shouldEventOccur(setup.schedule.schedule, date)) {
      const preferredTime = parseTime(setup.time.preferred)

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
          start: date.add(preferredTime, 'second').toDate(),
          end: date.add(preferredTime + setup.time.duration * 60, 'second').toDate(),
          time: {
            ...baseEvent.time,
            enforced: true,
            preferred: preferredTime,
            duration: setup.time.duration,
          },
        })
      } else {
        const [rangeStart, rangeEnd] = setup.time.range
        events.push({
          ...baseEvent,
          start: date.add(rangeStart, 'second').toDate(),
          end: date.add(rangeEnd, 'second').toDate(),
          time: {
            ...baseEvent.time,
            enforced: false,
            range: [rangeStart, rangeEnd],
            preferred: preferredTime,
            duration: setup.time.duration,
          },
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
