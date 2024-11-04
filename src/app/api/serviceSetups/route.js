// src/app/api/services/route.js
import { capitalize } from '@/app/utils/capitalize'
import { dayjsInstance as dayjs, convertToETTime } from '@/app/utils/dayjs'
import { readFromDiskCache, writeToDiskCache } from '@/app/utils/diskCache'
import { parseTimeRange } from '@/app/utils/timeRange'
import sql from 'mssql/msnodesqlv8'
import { NextResponse } from 'next/server'

const CACHE_FILE = 'serviceSetups.json'

sql.driver = 'FreeTDS'
const config = {
  server: process.env.SQL_SERVER,
  port: Number.parseInt(process.env.SQL_PORT),
  database: process.env.SQL_DATABASE,
  user: process.env.SQL_USERNAME,
  password: process.env.SQL_PASSWORD,
  options: {
    trustedConnection: false,
    enableArithAbort: true,
    encrypt: false,
    driver: 'FreeTDS',
  },
  connectionString: `Driver={FreeTDS};Server=${process.env.SQL_SERVER || '127.0.0.1'},${process.env.SQL_PORT || 1433};Database=${process.env.SQL_DATABASE};Uid=${process.env.SQL_USERNAME};Pwd=${process.env.SQL_PASSWORD};TDS_Version=7.4;`,
}

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

async function runQuery(pool, query) {
  try {
    const result = await pool.request().query(query)
    console.log('Query executed successfully')
    return result.recordset
  } catch (err) {
    console.error('Error executing query:', err)
    throw err
  }
}

function transformServiceSetup(setup) {
  const formatTechName = (fname, lname) => {
    if (!fname) return ''
    if (!lname) return fname
    return `${fname} ${lname.charAt(0)}.`
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
    company: capitalize(setup.Company),
    schedule: {
      code: setup.ScheduleCode,
      string: setup.ScheduleString,
      timesPerYear: setup.AnnualOccurrences,
    },
    tech: {
      code: setup.TechCode,
      name: formatTechName(setup.TechFName, setup.TechLName),
    },
    time: {
      range: [rangeStart, rangeEnd],
      preferred: convertToETTime(setup.WorkTime),
      // enforced: false,
      duration: setup.Duration,
      originalRange: setup.TimeRange,
    },
    route: {
      time: [
        convertToETTime(setup.RouteStartTime),
        convertToETTime(setup.RouteEndTime),
      ],
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

  let serviceSetups = await readFromDiskCache({ file: CACHE_FILE })

  if (!serviceSetups) {
    let pool
    try {
      console.log('Fetching service setups from database...')
      pool = await sql.connect(config)

      serviceSetups = await runQuery(pool, BASE_QUERY)
      console.log('Total service setups fetched:', serviceSetups.length)

      serviceSetups = serviceSetups.map(transformServiceSetup)
      console.log('Transformed setups:', serviceSetups.length)

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
    } finally {
      if (pool) {
        try {
          await pool.close()
          console.log('Database connection closed')
        } catch (closeErr) {
          console.error('Error closing database connection:', closeErr)
        }
      }
    }
  } else {
    console.log('Using cached data, total setups:', serviceSetups.length)
  }

  if (idParam) {
    const ids = idParam.split(',')
    serviceSetups = serviceSetups.filter(setup =>
      ids.includes(setup.id.toString()),
    )
    console.log(
      `Filtered to ${serviceSetups.length} setups for requested IDs: ${idParam}`,
    )
  }

  return NextResponse.json(serviceSetups)
}
