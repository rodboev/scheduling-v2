import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTimeRange, parseTime } from '@/app/utils/timeRange'
import axios from 'axios'
import fs from 'fs/promises'
import { NextResponse } from 'next/server'
import path from 'path'

function round(time) {
  if (!time) return null
  const minutes = time.minute()
  const roundedMinutes = Math.round(minutes / 15) * 15
  return time.minute(roundedMinutes).second(0).millisecond(0)
}

const isProduction = process.env.NODE_ENV === 'production'

const customServices = [
  {
    id: '14275-2024-09-01',
    location: {
      code: 120053,
      id: 46231,
      latitude: 40.690497,
      longitude: -73.995319,
      address: '145 Atlantic Ave',
      address2: 'Brooklyn, NY 11201-6739',
    },
    company: 'Luzzos Bk',
    tech: {
      code: 'GUITEREZ O',
      name: 'OSWALDO G.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T02:30:00.000Z', '2024-09-02T04:45:00.000Z'],
      preferred: '2024-09-02T03:00:00.000Z',
      duration: 45,
      meta: {
        dayRange: [81000, 86400],
        originalRange: '1030PM-12AM',
        preferred: '11:00pm',
      },
    },
    route: {
      time: ['10:30pm', '11:59pm'],
      days: '0000001',
    },
    date: '2024-09-01T04:00:00.000Z',
    schedule: {
      code: 'WSUN',
      timesPerYear: 52,
    },
  },
  {
    id: '19432-2024-09-02',
    location: {
      code: 133300,
      id: 60357,
      latitude: 40.702601,
      longitude: -73.99366,
      address: '17 Old Fulton St',
      address2: 'Brooklyn, NY 11201-1317',
    },
    company: 'Fulton Burger - Dumbo',
    tech: {
      code: 'GUITEREZ O',
      name: 'OSWALDO G.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T04:00:00.000Z', '2024-09-02T09:30:00.000Z'],
      preferred: '2024-09-02T08:00:00.000Z',
      duration: 30,
      meta: {
        dayRange: [0, 18000],
        originalRange: '12A-5A',
        preferred: '4:00am',
      },
    },
    route: {
      time: ['12:01am', '5:00am'],
      days: '1111000',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
  {
    id: '20356-2024-09-02',
    location: {
      code: 137842,
      id: 64885,
      latitude: 40.74713,
      longitude: -74.02797,
      address: '832 Washington St',
      address2: 'Hoboken, NJ 07030-5028',
    },
    company: 'Purple Rice',
    tech: {
      code: 'JONES H.',
      name: 'HARVEY J.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T04:00:00.000Z', '2024-09-02T13:30:00.000Z'],
      preferred: '2024-09-02T09:15:00.000Z',
      duration: 30,
      meta: {
        dayRange: [0, 32400],
        originalRange: '12A-9A',
        preferred: '5:15am',
      },
    },
    route: {
      time: ['12:01am', '6:00am'],
      days: '1111111',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
  {
    id: '11903-2024-09-02',
    location: {
      code: 114951,
      id: 40157,
      latitude: 40.670157,
      longitude: -73.936431,
      address: '265 Troy Ave',
      address2: 'Brooklyn, NY 11213-3601',
    },
    company: 'Mozzarella',
    tech: {
      code: 'HARRIS',
      name: 'JOSE H.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T05:00:00.000Z', '2024-09-02T10:30:00.000Z'],
      preferred: '2024-09-02T05:00:00.000Z',
      duration: 30,
      meta: {
        dayRange: [3600, 21600],
        originalRange: '1AM-6AM',
        preferred: '1:00am',
      },
    },
    route: {
      time: ['1:00am', '5:00am'],
      days: '1111000',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'WMON',
      timesPerYear: 52,
    },
  },
  {
    id: '18762-2024-09-02',
    location: {
      code: 133563,
      id: 60620,
      latitude: 40.655883,
      longitude: -73.915642,
      address: '496 E 96th St',
      address2: 'Brooklyn, NY 11212-2550',
    },
    company: 'Juice And Tings',
    tech: {
      code: 'HARRIS',
      name: 'JOSE H.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T05:00:00.000Z', '2024-09-02T08:30:00.000Z'],
      preferred: '2024-09-02T07:00:00.000Z',
      duration: 30,
      meta: {
        dayRange: [3600, 14400],
        originalRange: '1A-4A',
        preferred: '3:00am',
      },
    },
    route: {
      time: ['1:00am', '4:00am'],
      days: '1111100',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
  {
    id: '15359-2024-09-02',
    location: {
      code: 124533,
      id: 51683,
      latitude: 40.74632,
      longitude: -74.02821,
      address: '806 Washington Street',
      address2: 'Hoboken, NJ 07030-7040',
    },
    company: 'Vitos Italian Deli',
    tech: {
      code: 'GHANIM MO',
      name: 'MOHANED G.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T04:00:00.000Z', '2024-09-02T11:45:00.000Z'],
      preferred: '2024-09-02T12:00:00.000Z',
      duration: 45,
      meta: {
        dayRange: [0, 25200],
        originalRange: '12A-7A',
        preferred: '8:00am',
      },
    },
    route: {
      time: ['12:01am', '6:00am'],
      days: '1111111',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'WMON',
      timesPerYear: 52,
    },
  },
  {
    id: '3723-2024-09-02',
    location: {
      code: 109597,
      id: 8520,
      latitude: 40.702505,
      longitude: -73.989182,
      address: '111 Front St',
      address2: 'Brooklyn, NY 11201',
    },
    company: 'Almar',
    tech: {
      code: 'GUITEREZ O',
      name: 'OSWALDO G.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T04:00:00.000Z', '2024-09-02T10:45:00.000Z'],
      preferred: '2024-09-02T05:00:00.000Z',
      duration: 45,
      meta: {
        dayRange: [0, 21600],
        originalRange: '12AM-6AM',
        preferred: '1:00am',
      },
    },
    route: {
      time: ['12:01am', '6:00am'],
      days: '1111100',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
  {
    id: '12035-2024-09-02',
    location: {
      code: 115192,
      id: 40398,
      latitude: 40.68442,
      longitude: -73.992028,
      address: '214 Smith St',
      address2: 'Brooklyn, NY 11201-6437',
    },
    company: 'Cafe Luluc',
    tech: {
      code: 'GUITEREZ O',
      name: 'OSWALDO G.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T06:00:00.000Z', '2024-09-02T10:30:00.000Z'],
      preferred: '2024-09-02T05:45:00.000Z',
      duration: 30,
      meta: {
        dayRange: [7200, 21600],
        originalRange: '2AM-6AM',
        preferred: '1:45am',
      },
    },
    route: {
      time: ['2:00am', '6:00am'],
      days: '1111000',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
  {
    id: '20923-2024-09-02',
    location: {
      code: 128374,
      id: 55477,
      latitude: 40.72483,
      longitude: -73.994299,
      address: '55 E Houston St',
      address2: 'New York, NY 10012-2712',
    },
    company: "Pop's Bagel",
    tech: {
      code: 'LOPEZ A.',
      name: 'ALBERT L.',
      enforced: false,
    },
    time: {
      range: ['2024-09-02T10:00:00.000Z', '2024-09-02T12:30:00.000Z'],
      preferred: '2024-09-02T12:00:00.000Z',
      duration: 30,
      meta: {
        dayRange: [21600, 28800],
        originalRange: '6A-8A',
        preferred: '8:00am',
      },
    },
    route: {
      time: ['6:00am', '8:00am'],
      days: '1111111',
    },
    date: '2024-09-02T04:00:00.000Z',
    schedule: {
      code: 'M1/3MON',
      timesPerYear: 24,
    },
  },
]

function createServicesForDateRange(setup, startDate, endDate) {
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

  const startDate = dayjs(start).startOf('day')
  const endDate = dayjs(end).endOf('day')

  try {
    const serviceSetups = await fetchServiceSetups()

    // Generate services for the date range
    const services = serviceSetups.flatMap(setup =>
      createServicesForDateRange(setup, startDate, endDate),
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

    // Apply enforcement state to services and remove the schedule.string key
    const processedServices = services.map(
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

    // return NextResponse.json(customServices) // processedServices
    return NextResponse.json(processedServices)
  } catch (error) {
    console.error('Error processing services:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
