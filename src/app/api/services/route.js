import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { getRedisClient } from '@/app/utils/redis'
import { parseTime } from '@/app/utils/timeRange'
import axios from 'axios'
import { NextResponse } from 'next/server'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

// === Regular service retrieval ===
// GET /api/services?start=2024-09-01&end=2024-09-02
// (fetch('/api/services?start=2024-09-01&end=2024-09-02')

// === Service regeneration with default date range ===
// GET /api/services?regenerate=true
// fetch('/api/services?regenerate=true')

// === Service regeneration with custom date range (needs testing) ===
// GET /api/services?regenerate=true&start=2024-09-01&end=2024-12-31
// fetch('/api/services?regenerate=true&start=2024-09-01&end=2024-12-31')

// Utility Functions
function round(time) {
  if (!time) return null
  const minutes = time.minute()
  const roundedMinutes = Math.round(minutes / 15) * 15
  return time.minute(roundedMinutes).second(0).millisecond(0)
}

function shouldServiceOccur(scheduleString, date) {
  if (scheduleString.length !== 420) {
    throw new Error('The schedule string must be 420 characters long.')
  }

  const targetDate = new Date(date)
  const year = targetDate.getFullYear()
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const janFirst = new Date(year, 0, 1)
  const janFirstWeekday = janFirst.getDay()
  const firstThursdayOffset = (4 - janFirstWeekday + 7) % 7
  const firstThursdayIndex = firstThursdayOffset + 1

  const adjustedSchedule =
    scheduleString.slice(firstThursdayIndex - 1) +
    scheduleString.slice(0, firstThursdayIndex - 1)

  const finalSchedule = isLeapYear
    ? `${adjustedSchedule.slice(0, 59)}0${adjustedSchedule.slice(59)}`
    : adjustedSchedule

  const startOfYear = new Date(year, 0, 1)
  const dayOfYear = Math.floor(
    (targetDate - startOfYear) / (1000 * 60 * 60 * 24) + 1,
  )

  return finalSchedule[dayOfYear - 1] === '1'
}

function validateServiceSetup(setup) {
  const errors = []

  if (!setup.id || !setup.company || !setup.time || !setup.location) {
    errors.push('Missing required fields (id, company, time, or location)')
  }

  if (!setup.time?.preferred) {
    errors.push('Missing preferred time')
  }

  if (
    !setup.time?.range ||
    setup.time.range[0] === undefined ||
    setup.time.range[0] === null ||
    setup.time.range[1] === undefined ||
    setup.time.range[1] === null
  ) {
    errors.push('Missing or invalid time range')
  }

  if (!setup.location?.latitude || !setup.location?.longitude) {
    errors.push('Missing geocoordinates')
  }

  if (!setup.time?.duration || setup.time.duration <= 0) {
    errors.push('Invalid duration')
  }

  if (!setup.schedule?.string || setup.schedule.string.length !== 420) {
    errors.push('Invalid schedule string')
  }

  return {
    isValid: errors.length === 0,
    errors,
    setup,
  }
}

function createServicesForRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

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

      if (process.env.NODE_ENV !== 'production') delete setup.comments

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

async function storeServicesInRedis(redis, services) {
  const pipeline = redis.pipeline()

  for (const service of services) {
    const timestamp = new Date(service.time.range[0]).getTime()
    pipeline.zadd('services', timestamp, service.id)
    pipeline.hset(`service:${service.id}`, {
      ...service,
      time: JSON.stringify(service.time),
      location: JSON.stringify(service.location),
      tech: JSON.stringify(service.tech),
      schedule: JSON.stringify(service.schedule),
    })
  }

  await pipeline.exec()
  return services
}

async function getServicesFromRedis(redis, start, end) {
  const startDate = dayjs(start)
  const endDate = dayjs(end)

  const serviceIds = await redis.zrangebyscore(
    'services',
    startDate.valueOf(),
    endDate.valueOf(),
  )

  if (serviceIds.length === 0) return []

  const services = await Promise.all(
    serviceIds.map(async serviceId => {
      const data = await redis.hgetall(`service:${serviceId}`)
      if (!data) return null

      return {
        ...data,
        time: JSON.parse(data.time),
        location: JSON.parse(data.location),
        tech: JSON.parse(data.tech),
        schedule: JSON.parse(data.schedule),
      }
    }),
  )

  return services
    .filter(Boolean)
    .sort(
      (a, b) =>
        dayjs(a.time.range[0]).valueOf() - dayjs(b.time.range[0]).valueOf(),
    )
}

async function fetchServiceSetups(baseUrl) {
  try {
    const response = await axios.get(`${baseUrl}/api/serviceSetups`)
    return response.data
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw new Error(`Failed to fetch service setups: ${error.message}`)
  }
}

async function getEnforcementState() {
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
      console.error('Error reading enforcement state file:', error)
    }
  }

  return enforcementState
}

async function processServicesWithEnforcement(services) {
  const enforcementState = await getEnforcementState()

  return services.map(
    ({ schedule: { string, ...restSchedule }, ...restService }) => {
      const serviceSetupId = restService.id.split('-')[0]
      return {
        ...restService,
        schedule: restSchedule,
        tech: {
          ...restService.tech,
          enforced: enforcementState[serviceSetupId] || false,
        },
      }
    },
  )
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  const regenerate = searchParams.get('regenerate') === 'true'
  const redis = getRedisClient()

  // Handle regeneration request
  if (regenerate) {
    try {
      // ... existing regeneration code ...
      const services = validSetups.flatMap(setup =>
        createServicesForRange(setup, quarterStart, quarterEnd),
      )

      const processedServices = await processServicesWithEnforcement(services)
      await storeServicesInRedis(redis, processedServices)

      return NextResponse.json({
        message: 'Services regenerated',
        servicesCreated: processedServices.length,
        validSetups: validSetups.length,
        invalidSetups: validationResults.filter(r => !r.isValid).length,
      })
    } catch (error) {
      // ... existing error handling ...
    }
  }

  // Handle regular service retrieval
  if (!start || !end) {
    return NextResponse.json(
      { error: 'Start and end dates are required' },
      { status: 400 },
    )
  }

  try {
    const services = await getServicesFromRedis(redis, start, end)

    if (services.length === 0) {
      console.log('No services found in Redis, generating new ones...')
      const protocol = request.headers.get('x-forwarded-proto') || 'http'
      const host = request.headers.get('host')
      const baseUrl = `${protocol}://${host}`

      const serviceSetups = await fetchServiceSetups(baseUrl)
      const newServices = serviceSetups.flatMap(setup =>
        createServicesForRange(setup, start, end),
      )

      if (newServices.length > 0) {
        const processedServices =
          await processServicesWithEnforcement(newServices)
        await storeServicesInRedis(redis, processedServices)
        return NextResponse.json(processedServices)
      }
    }

    return NextResponse.json(services)
  } catch (error) {
    console.error('Error processing services:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve services', details: error.message },
      { status: 500 },
    )
  }
}
