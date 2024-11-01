import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export function round(time) {
  if (!time) return null
  const minutes = time.minute()
  const roundedMinutes = Math.round(minutes / 15) * 15
  return time.minute(roundedMinutes).second(0).millisecond(0)
}

export function shouldServiceOccur(scheduleString, date) {
  // Verify that scheduleString has the expected length of 420 characters
  if (scheduleString.length !== 420) {
    throw new Error('The schedule string must be 420 characters long.')
  }

  // Parse the date argument into a JavaScript Date object
  const targetDate = new Date(date)
  const year = targetDate.getFullYear()

  // Determine if it's a leap year
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)

  // Calculate the weekday of January 1st for this year
  const janFirst = new Date(year, 0, 1)
  const janFirstWeekday = janFirst.getDay()

  // Calculate the first Thursday of the year, using 1-indexing
  const firstThursdayOffset = (4 - janFirstWeekday + 7) % 7
  const firstThursdayIndex = firstThursdayOffset + 1

  // Rotate the schedule string so the first '1' aligns with the first Thursday
  const adjustedSchedule =
    scheduleString.slice(firstThursdayIndex - 1) +
    scheduleString.slice(0, firstThursdayIndex - 1)

  // Handle leap year
  const finalSchedule = isLeapYear
    ? `${adjustedSchedule.slice(0, 59)}0${adjustedSchedule.slice(59)}`
    : adjustedSchedule

  // Calculate the day of year
  const startOfYear = new Date(year, 0, 1)
  const dayOfYear = Math.floor(
    (targetDate - startOfYear) / (1000 * 60 * 60 * 24) + 1,
  )

  return finalSchedule[dayOfYear - 1] === '1'
}

export function validateServiceSetup(setup) {
  const errors = []

  // Required fields
  if (!setup.id || !setup.company || !setup.time || !setup.location) {
    errors.push('Missing required fields (id, company, time, or location)')
  }

  // Time validation
  if (!setup.time?.preferred) {
    errors.push('Missing preferred time')
  }

  // Time range validation
  if (
    !setup.time?.range ||
    setup.time.range[0] === undefined ||
    setup.time.range[0] === null ||
    setup.time.range[1] === undefined ||
    setup.time.range[1] === null
  ) {
    errors.push('Missing or invalid time range')
  }

  // Location validation
  if (!setup.location?.latitude || !setup.location?.longitude) {
    errors.push('Missing geocoordinates')
  }

  // Duration validation
  if (!setup.time?.duration || setup.time.duration <= 0) {
    errors.push('Invalid duration')
  }

  // Schedule validation
  if (!setup.schedule?.string || setup.schedule.string.length !== 420) {
    errors.push('Invalid schedule string')
  }

  return {
    isValid: errors.length === 0,
    errors,
    setup: {
      id: setup.id,
      company: setup.company,
      location: setup.location?.id,
    },
  }
}

export function createServicesForRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  // Validate setup time fields first
  if (
    !setup.time?.preferred &&
    !setup.time?.range[0] &&
    !setup.route?.time[0]
  ) {
    console.warn(
      `Missing time information for setup ${setup.id} (${setup.company})`,
    )
    return []
  }

  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    try {
      if (!shouldServiceOccur(setup.schedule.string, date)) continue

      const rangeStart =
        setup.time.range[0] !== null
          ? round(date.add(setup.time.range[0], 'seconds'))
          : null

      // Handle overnight services
      let rangeEnd
      if (setup.time.range[1] !== null) {
        const startTime = date.add(setup.time.range[0], 'seconds')
        let endTime = date.add(setup.time.range[1], 'seconds')

        if (endTime.isBefore(startTime)) {
          endTime = endTime.add(1, 'day')
        }

        rangeEnd = round(endTime.add(setup.time.duration, 'minutes'))
      }

      const preferred = round(
        date.add(
          parseTime(
            setup.time.preferred || setup.time.range[0] || setup.route.time[0],
          ),
          'seconds',
        ),
      )
      const duration = Math.round(setup.time.duration / 15) * 15

      if (!process.env.NODE_ENV === 'production') delete setup.comments

      const service = {
        ...setup,
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        date: date.toDate(),
        time: {
          range: [rangeStart?.toDate(), rangeEnd?.toDate()],
          preferred: preferred?.toDate(),
          duration,
          meta: {
            dayRange: setup.time.range,
            originalRange: setup.time.originalRange,
            preferred: setup.time.preferred,
          },
        },
      }

      if (!service.time.range[0] || !service.time.preferred) {
        console.warn(`Invalid time values for service ${service.id}:`, {
          range: service.time.range,
          preferred: service.time.preferred,
        })
        continue
      }

      services.push(service)
    } catch (error) {
      console.error(
        `Error creating service for ${setup.company} on ${date.format('YYYY-MM-DD')}:`,
        error,
      )
    }
  }

  return services
}
