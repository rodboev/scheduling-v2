// src/app/api/services/route.js

import { NextResponse } from 'next/server'
import sql from 'mssql/msnodesqlv8.js'
import { dayjsInstance as dayjs, convertToETTime } from '@/app/utils/dayjs'
import { parseTimeRange } from '@/app/utils/timeRange'

sql.driver = 'FreeTDS'
const config = {
  server: process.env.SQL_SERVER,
  port: parseInt(process.env.SQL_PORT),
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
      Locations.Company,
      Locations.LocationCode,
      Schedules.ScheduleID AS ScheduleID,
      Schedules.Code AS ScheduleCode,
      Schedules.Description AS ScheduleDescription,
      Schedules.Schedule AS ScheduleString,
      ServiceSetups.Comment AS ServiceSetupComment,
      Locations.Comment AS LocationComment
  FROM 
      ServiceSetups
  JOIN 
      Locations ON ServiceSetups.LocationID = Locations.LocationID
  JOIN 
      Schedules ON ServiceSetups.ScheduleID = Schedules.ScheduleID
  LEFT JOIN
      Technicians ON ServiceSetups.TechID1 = Technicians.TechID
  WHERE 
      ServiceSetups.Active = 1
`

async function runQuery(pool, query) {
  try {
    const result = await pool.request().query(query)
    console.log('Query executed successfully')
    return result.recordset
  } catch (err) {
    console.error(`Error executing query:`, err)
    throw err
  }
}

async function getServiceSetups(pool, ids) {
  try {
    // Create a temporary table to hold the IDs
    await pool.request().query(`
      CREATE TABLE #TempIds (ID INT);
      ${ids.map((id) => `INSERT INTO #TempIds (ID) VALUES (${id});`).join('\n')}
    `)

    const query = `
      ${BASE_QUERY}
      AND ServiceSetups.SetupID IN (SELECT ID FROM #TempIds);

      DROP TABLE #TempIds;
    `

    return await runQuery(pool, query)
  } catch (error) {
    console.error('Error in getServiceSetups:', error)
    throw error
  }
}

function transformServiceSetup(setup) {
  const formatTechName = (fname, lname) => {
    if (!fname) return ''
    if (!lname) return fname
    return `${fname} ${lname.charAt(0)}.`
  }

  const [rangeStart, rangeEnd] = setup.TimeRange
    ? parseTimeRange(setup.TimeRange, setup.Duration)
    : [null, null]

  return {
    id: setup.id,
    locationCode: setup.LocationCode,
    company: setup.Company,
    schedule: {
      id: setup.ScheduleID,
      code: setup.ScheduleCode,
      description: setup.ScheduleDescription,
      string: setup.ScheduleString,
      // schedule: setup.ScheduleString,
    },
    tech: {
      id: setup.TechID1,
      code: setup.TechCode,
      name: formatTechName(setup.TechFName, setup.TechLName),
      enforced: false,
    },
    time: {
      range: [rangeStart, rangeEnd],
      preferred: convertToETTime(setup.WorkTime),
      enforced: false,
      duration: setup.Duration,
      originalRange: setup.TimeRange,
    },
    comments: {
      serviceSetup: setup.ServiceSetupComment,
      location: setup.LocationComment,
    },
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)

  // Parse date range parameters
  const startDate = searchParams.get('startDate') || '2024-09-02'
  const endDate = searchParams.get('endDate') || '2024-09-02'

  console.log('Start Date:', startDate)
  console.log('End Date:', endDate)

  let pool
  try {
    console.log('Fetching service setups from database...')
    pool = await sql.connect(config)

    const serviceSetups = await runQuery(pool, BASE_QUERY)
    console.log('Total service setups fetched:', serviceSetups.length)

    // Transform all service setups immediately
    const transformedSetups = serviceSetups.map(transformServiceSetup)
    console.log('Transformed setups:', transformedSetups.length)

    // Then filter the transformed setups based on the date range
    const filteredSetups = transformedSetups.filter((setup) => {
      const scheduleArray = setup.schedule.string.split('')
      const start = dayjs(startDate).subtract(1, 'day') // Start from the day before
      const end = dayjs(endDate).add(1, 'day') // End on the day after

      let currentDate = start

      while (currentDate.isBefore(end)) {
        const dayOfWeek = currentDate.day()
        const scheduleIndex = (dayOfWeek + 6) % 7
        const nextDayOfWeek = (dayOfWeek + 1) % 7
        const nextScheduleIndex = (nextDayOfWeek + 6) % 7

        if (scheduleArray[scheduleIndex] === '1' || scheduleArray[nextScheduleIndex] === '1') {
          // console.log(`Setup ${setup.id} matched for date ${currentDate.format('YYYY-MM-DD')}`)
          return true
        }
        currentDate = currentDate.add(1, 'day')
      }
      // console.log(`Setup ${setup.id} did not match any dates in the range`)
      return false
    })

    console.log('Filtered setups:', filteredSetups.length)

    if (filteredSetups.length === 0) {
      console.log('No service setups found for the given date range')
      return NextResponse.json({ message: 'No service setups found' }, { status: 404 })
    }

    console.log(`Retrieved ${filteredSetups.length} service setups`)
    return NextResponse.json(filteredSetups)
  } catch (error) {
    console.error('Error in GET function:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message, stack: error.stack },
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
}
