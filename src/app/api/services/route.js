import { getDefaultDateRange } from '@/app/utils/dates'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTimeRange, parseTime, round } from '@/app/utils/timeRange'
import axios from 'axios'
import { NextResponse } from 'next/server'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
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
  return scheduleString[scheduleIndex] === '1'
}

async function fetchServiceSetups() {
  try {
    const response = await axios.get(`${BASE_URL}/api/serviceSetups`)
    console.log('Fetched service setups:', response.data.length)
    return response.data
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange()

  const start = searchParams.get('start') || defaultStart
  const end = searchParams.get('end') || defaultEnd

  const startDate = dayjs(start)
  const endDate = dayjs(end)

  try {
    const serviceSetups = await fetchServiceSetups()

    // Generate services for the date range
    const services = serviceSetups.flatMap(setup =>
      createServicesForRange(setup, startDate, endDate),
    )

    // Read enforcement state
    const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')
    let enforcementState = {}

    try {
      const rawEnforcementState = await fsPromises.readFile(filePath, 'utf8')
      const parsedState = JSON.parse(rawEnforcementState)
      if (parsedState?.cacheData) {
        enforcementState = parsedState.cacheData
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fsPromises.writeFile(filePath, JSON.stringify({ cacheData: {} }))
      } else {
        console.error('Error reading enforcement state:', error)
      }
    }

    // Apply enforcement state
    const servicesWithEnforcement = services.map(service => ({
      ...service,
      tech: {
        ...service.tech,
        enforced: enforcementState[service.id.split('-')[0]] || false,
      },
    }))

    return NextResponse.json(servicesWithEnforcement)
  } catch (error) {
    console.error('Error generating services:', error)
    return NextResponse.json(
      { error: 'Failed to generate services' },
      { status: 500 },
    )
  }
}
