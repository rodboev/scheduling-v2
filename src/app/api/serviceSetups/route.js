// src/app/api/services/route.js
import { getPool } from '@/lib/db.js'
import { capitalize } from '@/app/utils/capitalize'
import { dayjsInstance as dayjs, convertToETTime } from '@/app/utils/dayjs'
import { readFromDiskCache, writeToDiskCache } from '@/app/utils/diskCache'
import { parseTimeRange } from '@/app/utils/timeRange'
import { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const CACHE_FILE = 'serviceSetups.json'

// Lmit to 20 techs
const ALLOWED_TECHS = [
  // 'BELTRAN',
  // 'BAEZ MALIK',
  // 'BLAKAJ A.',
  // 'CAPALDI J.',
  // 'CAPPA T.',
  // 'CHIN SAU',
  'CORA JOSE',
  // 'CRUZ N.',
  'FERNANDEZ',
  'GHANIM MO',
  'GUITEREZ O',
  // 'FORD J.',
  // 'HARRIS',
  // 'HUNTLEY E.',
  // 'JOHNI',
  // 'JONES H.',
  // 'LOPEZ A.',
  // 'MADERA M.',
  // 'RIVERS',
  // 'VASTA RICK',
]

const BASE_QUERY = `
  SELECT 
      ServiceSetups.SetupID AS id,
      ServiceSetups.LocationID,
      ServiceSetups.ServiceCode,
      ServiceSetups.ScheduleID,
      ServiceSetups.TechID1,
      Technicians.Code AS TechCode,
      Technicians.FName AS TechFName,
      Technicians.LName AS TechLName,
      ServiceSetups.WorkTime,
      ServiceSetups.TimeRange,
      ServiceSetups.Duration,
      ServiceSetups.RouteOptTime1Beg as RouteStartTime,
      ServiceSetups.RouteOptTime1End as RouteEndTime,
      ServiceSetups.RouteOptIncludeDays,
      Locations.Company,
      Locations.FName,
      Locations.LName,
      Locations.LocationCode,
      Locations.Latitude,
      Locations.Longitude,
      Locations.Address,
      Locations.City,
      Locations.State,
      Locations.Zip,
      Schedules.ScheduleID AS ScheduleID,
      Schedules.Code AS ScheduleCode,
      Schedules.Description AS ScheduleDescription,
      Schedules.Schedule AS ScheduleString,
      ServiceSetups.Comment AS ServiceSetupComment,
      Locations.Comment AS LocationComment,
      FrequencyClasses.AnnualOccurrences
  FROM 
      ServiceSetups
  JOIN 
      Locations ON ServiceSetups.LocationID = Locations.LocationID
  JOIN 
      Schedules ON ServiceSetups.ScheduleID = Schedules.ScheduleID
  LEFT JOIN
      Technicians ON ServiceSetups.TechID1 = Technicians.TechID
  LEFT JOIN
      FrequencyClasses ON Schedules.FrequencyID = FrequencyClasses.FrequencyID
  WHERE 
      ServiceSetups.Active = 1
`

async function runQuery(query) {
  const pool = await getPool()
  try {
    const result = await pool.request().query(query)
    console.log('Query executed successfully')
    return result.recordset
  } catch (err) {
    console.error(`Error executing query:`, err)
    throw err
  }
}

async function getEnforcementState() {
  try {
    const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')
    const rawData = await fs.readFile(filePath, 'utf8')
    const { cacheData } = JSON.parse(rawData)
    return cacheData || {}
  } catch (error) {
    console.warn('Error reading enforcement state:', error)
    return {}
  }
}

function transformServiceSetup(setup, enforcementState) {
  const formatTechName = (fname, lname) => {
    if (!fname) return ''
    if (!lname) return fname
    return `${fname} ${lname.charAt(0)}.`
  }

  const formatCompanyName = (company, fname, lname) => {
    if (company?.trim()) return company // capitalize(company)
    if (fname && lname) return `${capitalize(fname)} ${capitalize(lname)}`
    return capitalize(fname || lname || 'Unnamed Location')
  }

  let [rangeStart, rangeEnd] = setup.TimeRange
    ? parseTimeRange(setup.TimeRange, setup.Duration)
    : [null, null]

  // If time range is [null, null], try to use route time
  if (rangeStart === null && rangeEnd === null) {
    rangeStart = convertToETTime(setup.RouteStartTime)
    rangeEnd = convertToETTime(setup.RouteEndTime)
  }

  // If both time range and route time are [null, null], return null to exclude this service
  if (rangeStart === null && rangeEnd === null) {
    return null
  }

  return {
    id: setup.id,
    location: {
      code: setup.LocationCode,
      id: setup.LocationID,
      latitude: setup.Latitude,
      longitude: setup.Longitude,
      address: capitalize(setup.Address),
      address2: `${capitalize(setup.City)}, ${setup.State} ${setup.Zip}`,
    },
    company: formatCompanyName(setup.Company, setup.FName, setup.LName),
    schedule: {
      code: setup.ScheduleCode,
      string: setup.ScheduleString,
      timesPerYear: setup.AnnualOccurrences,
    },
    tech: {
      code: setup.TechCode,
      name: formatTechName(setup.TechFName, setup.TechLName),
      enforced: enforcementState[setup.id] || false,
    },
    time: {
      range: [rangeStart, rangeEnd],
      preferred: convertToETTime(setup.WorkTime),
      duration: setup.Duration,
      originalRange: setup.TimeRange,
    },
    route: {
      time: [convertToETTime(setup.RouteStartTime), convertToETTime(setup.RouteEndTime)],
      days: setup.RouteOptIncludeDays,
    },
    comments: {
      serviceSetup: setup.ServiceSetupComment,
      location: setup.LocationComment,
    },
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const idParam = searchParams.get('id')

  // Always try to read from disk cache first
  let serviceSetups = await readFromDiskCache({ file: CACHE_FILE })
  const enforcementState = await getEnforcementState()

  if (!serviceSetups) {
    try {
      console.log('Fetching service setups from database...')
      serviceSetups = await runQuery(BASE_QUERY)
      console.log('Total service setups fetched:', serviceSetups.length)

      // Transform all service setups immediately
      serviceSetups = serviceSetups
        .map((setup) => transformServiceSetup(setup, enforcementState))
        .filter(Boolean)
      console.log('Transformed setups:', serviceSetups.length)

      // Write all fetched and transformed data to disk cache
      await writeToDiskCache({ file: CACHE_FILE, data: serviceSetups })
    } catch (error) {
      console.error('Error fetching from database:', error)
      return NextResponse.json(
        {
          error: 'Internal Server Error',
          details: error.message,
          stack: error.stack,
        },
        { status: 500 },
      )
    }
  } else {
    // Add enforcement state to cached data
    serviceSetups = serviceSetups.map((setup) => ({
      ...setup,
      tech: {
        ...setup.tech,
        enforced: enforcementState[setup.id] || false,
      },
    }))
    console.log('Using cached data, total setups:', serviceSetups.length)
  }

  // Filter by ALLOWED_TECHS if necessary
  if (ALLOWED_TECHS?.length > 0) {
    serviceSetups = serviceSetups.filter(
      (setup) => setup?.tech?.code && ALLOWED_TECHS.includes(setup?.tech?.code),
    )
    console.log(
      `Filtered to ${serviceSetups.length} setups for ${ALLOWED_TECHS.length} allowed techs`,
    )
  }

  // Filter by specific IDs if idParam is present
  if (idParam) {
    const ids = idParam.split(',')
    // Check both setup IDs and location IDs
    serviceSetups = serviceSetups.filter(
      (setup) => ids.includes(setup.id.toString()) || ids.includes(setup.location?.id?.toString()),
    )
    // console.log(
    //   `Filtered to ${serviceSetups.length} setups for requested IDs (checking both setup and location IDs): ${idParam}`,
    // )
  }

  return NextResponse.json(serviceSetups)
}
