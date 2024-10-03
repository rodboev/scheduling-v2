import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTimeRange, parseTime } from '@/app/utils/timeRange'
import axios from 'axios'
import fs from 'fs/promises'
import { NextResponse } from 'next/server'
import path from 'path'
import customServices from './customServices.json'

function round(time) {
  if (!time) return null
  const minutes = time.minute()
  const roundedMinutes = Math.round(minutes / 15) * 15
  return time.minute(roundedMinutes).second(0).millisecond(0)
}

const isProduction = process.env.NODE_ENV === 'production'

function createServicesForRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    if (shouldServiceOccur(setup.schedule.string, date)) {
      const rangeStart =
        setup.time.range[0] !== null
          ? round(date.add(setup.time.range[0], 'seconds'))
          : null
      const rangeEnd =
        setup.time.range[1] !== null
          ? round(
              date
                .add(setup.time.range[1], 'seconds')
                .add(setup.time.duration, 'minutes'),
            )
          : null
      const preferred = round(
        date.add(parseTime(setup.time.preferred), 'seconds'),
      )
      const duration = Math.round(setup.time.duration / 15) * 15

      if (!isProduction) delete setup.comments
      services.push({
        ...setup,
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        date: date.toDate(),
        time: {
          range: [rangeStart, rangeEnd],
          preferred,
          duration,
          meta: {
            dayRange: setup.time.range,
            originalRange: setup.time.originalRange,
            preferred: setup.time.preferred,
          },
        },
      })
    }
  }

  return services
}

function shouldServiceOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  const scheduleIndex = dayOfYear
  const shouldOccur = scheduleString[scheduleIndex] === '1'
  return shouldOccur
}

async function fetchServiceSetups() {
  try {
    const response = await axios.get(
      `http://localhost:${process.env.PORT}/api/serviceSetups`, // ?id=14275,20356,19432,11903,12035,18762,3723,15359,20923,20700,480,12271,18923,5143,20513,20730
    )
    const serviceSetups = response.data
    console.log('Fetched service setups:', serviceSetups.length)
    return serviceSetups
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error // Rethrow the error to be handled by the caller
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json(
      { error: 'Start and end dates are required' },
      { status: 400 },
    )
  }

  const startDate = dayjs(start)
  const endDate = dayjs(end)

  try {
    const serviceSetups = await fetchServiceSetups()

    // Generate services for the date range
    const services = serviceSetups.flatMap(setup =>
      createServicesForRange(
        setup,
        startDate.startOf('day'),
        endDate.endOf('day'),
      ),
    )

    // Read enforcement state directly from file
    const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')
    let enforcementState = {}
    try {
      const rawEnforcementState = await fs.readFile(filePath, 'utf8')
      const parsedState = JSON.parse(rawEnforcementState)
      if (parsedState && parsedState.cacheData) {
        enforcementState = parsedState.cacheData
      }
    } catch (error) {
      console.error('Error reading or parsing enforcement state file:', error)
    }

    // Apply enforcement state to services, remove the schedule.string key, and filter by time range
    const processedServices = services
      .map(({ schedule: { string, ...restSchedule }, ...restService }) => {
        const serviceSetupId = restService.id.split('-')[0]
        return {
          ...restService,
          schedule: restSchedule,
          tech: {
            ...restService.tech,
            enforced: enforcementState[serviceSetupId] || false,
          },
        }
      })
      .filter(service => {
        const serviceStart = dayjs(service.time.range[0])
        const serviceEnd = dayjs(service.time.range[1])

        // Handle services that cross midnight
        const serviceEndAdjusted = serviceEnd.isBefore(serviceStart)
          ? serviceEnd.add(1, 'day')
          : serviceEnd

        return (
          (serviceStart.isBefore(endDate) &&
            serviceEndAdjusted.isAfter(startDate)) ||
          serviceStart.isSame(startDate) ||
          serviceEndAdjusted.isSame(endDate)
        )
      })

    return NextResponse.json(processedServices)
  } catch (error) {
    console.error('Error processing services:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
