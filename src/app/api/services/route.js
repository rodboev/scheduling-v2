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

  // Create services for the date range, including the end date
  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    if (shouldServiceOccur(setup.schedule.string, date)) {
      // Create the service's time window based on its original range
      const rangeStart =
        setup.time.range[0] !== null
          ? date.startOf('day').add(setup.time.range[0], 'seconds')
          : null
      const rangeEnd =
        setup.time.range[1] !== null
          ? date.startOf('day').add(setup.time.range[1], 'seconds')
          : null
      const preferred = date.startOf('day').add(parseTime(setup.time.preferred), 'seconds')
      const duration = Math.round(setup.time.duration / 15) * 15

      // Calculate scheduled start time based on preferred time
      const scheduledStart = preferred
      const scheduledEnd = dayjs(scheduledStart).add(duration, 'minutes')

      // Only create service if scheduled times fall within the time window
      if (rangeStart && rangeEnd && scheduledStart && scheduledEnd) {
        services.push({
          ...setup,
          id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
          date: date.toDate(),
          start: scheduledStart.toDate(),
          end: scheduledEnd.toDate(),
          time: {
            range: [rangeStart.toDate(), rangeEnd.toDate()],
            preferred: preferred.toDate(),
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
  }

  return services
}

function shouldServiceOccur(scheduleString, date) {
  // Check if the service should occur on this date based on the schedule string
  const dayOfYear = date.dayOfYear()
  const scheduleIndex = dayOfYear - 1 // 0-based index
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

    // Find techs without services in date range
    const allTechs = [...new Set(serviceSetups.map(setup => setup.tech.code))]
    console.log('Total techs:', allTechs.length)

    const techsWithServices = allTechs.filter(code =>
      services.some(service => service.tech.code === code),
    )
    console.log('Techs with services:', techsWithServices.length)

    const techsWithoutServices = allTechs.filter(code => !techsWithServices.includes(code))
    // console.log(`Techs without services between ${start} and ${end}:`, techsWithoutServices)

    // Apply enforcement state
    const servicesWithEnforcement = services.map(service => ({
      ...service,
      tech: {
        ...service.tech,
        enforced: enforcementState[service.id.split('-')[0]] || false,
      },
    }))

    return new Response(JSON.stringify(servicesWithEnforcement, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error generating services:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to generate services: ' + error.message }, null, 2),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    )
  }
}
