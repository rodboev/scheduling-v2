import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTimeRange } from '@/app/utils/timeRange'
import axios from 'axios'
import { NextResponse } from 'next/server'

function createServicesForDateRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    if (shouldServiceOccur(setup.schedule.string, date)) {
      const baseService = {
        ...setup,
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        date: date.toDate(),
      }

      if (setup.time.enforced) {
        services.push({
          ...baseService,
          start: date.add(parseTime(setup.time.preferred), 'second').toDate(),
          end: date
            .add(parseTime(setup.time.preferred) + setup.time.duration * 60, 'second')
            .toDate(),
        })
      }
      else {
        const [rangeStart, rangeEnd] = parseTimeRange(setup.time.originalRange, setup.time.duration)
        services.push({
          ...baseService,
          start: date.add(rangeStart, 'second').toDate(),
          end: date.add(rangeEnd, 'second').toDate(),
        })
      }

      // Ensure the tech.enforced property is carried over
      services[services.length - 1].tech.enforced = setup.tech.enforced
    }
  }

  return services.map(service => {
    let serviceEnd = dayjs(service.end)
    if (serviceEnd.isBefore(service.start)) {
      // If the end time is before the start time, it means the service spans past midnight
      serviceEnd = serviceEnd.add(1, 'day')
    }
    return {
      ...service,
      end: serviceEnd.toDate(),
    }
  })
}

function shouldServiceOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  const scheduleIndex = dayOfYear
  const shouldOccur = scheduleString[scheduleIndex] === '1'
  return shouldOccur
}

async function fetchServiceSetups() {
  try {
    const response = await axios.get(`http://localhost:${process.env.PORT}/api/serviceSetups`)
    const serviceSetups = response.data
    console.log('Fetched service setups:', serviceSetups.length)
    return serviceSetups
  }
  catch (error) {
    console.error('Error fetching service setups:', error)
    throw error // Rethrow the error to be handled by the caller
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json({ error: 'Start and end dates are required' }, { status: 400 })
  }

  const startDate = dayjs(start).startOf('day')
  const endDate = dayjs(end).endOf('day')

  try {
    const serviceSetups = await fetchServiceSetups()

    // Generate services for the date range
    const services = serviceSetups.flatMap(setup =>
      createServicesForDateRange(setup, startDate, endDate),
    )

    // Strip out the schedule.string key from the services
    const strippedServices = services.map(service => {
      const { schedule, ...rest } = service
      return {
        ...rest,
        schedule: {
          ...schedule,
          string: undefined,
        },
      }
    })

    return NextResponse.json(strippedServices)
  }
  catch (error) {
    console.error('Error processing services:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
