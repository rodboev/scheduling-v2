// src/app/api/notes/route.js

import { NextResponse } from 'next/server'
import sql from 'mssql/msnodesqlv8.js'
import { convertToETTime } from '@/app/utils/dayjs'

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
console.log(config.connectionString)

async function runQuery(pool, query) {
  try {
    const result = await pool.request().query(query)
    console.log('Query successful')
    return result.recordset
  } catch (err) {
    console.error(`Error executing query:`, err)
    throw err
  }
}

async function getServiceSetups(pool, ids) {
  // Create a temporary table to hold the IDs
  await pool.request().query(`
    CREATE TABLE #TempIds (ID INT);
    ${ids.map((id) => `INSERT INTO #TempIds (ID) VALUES (${id});`).join('\n')}
  `)

  const query = `
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
        Schedules.ScheduleID AS schedule_id,
        Schedules.Code AS schedule_code,
        Schedules.Description AS schedule_description,
        Schedules.Schedule AS schedule_schedule,
        ServiceSetups.Comment AS serviceSetupComments,
        Locations.Comment AS locationComments
    FROM 
        ServiceSetups
    JOIN 
        Locations ON ServiceSetups.LocationID = Locations.LocationID
    JOIN 
        Schedules ON ServiceSetups.ScheduleID = Schedules.ScheduleID
    LEFT JOIN
        Technicians ON ServiceSetups.TechID1 = Technicians.TechID
    JOIN
        #TempIds ON ServiceSetups.SetupID = #TempIds.ID
    WHERE 
        ServiceSetups.Active = 1;

    DROP TABLE #TempIds;
  `

  return await runQuery(pool, query)
}

function transformServiceSetup(setup) {
  const formatTechName = (fname, lname) => {
    if (!fname) return ''
    if (!lname) return fname
    return `${fname} ${lname.charAt(0)}.`
  }

  return {
    id: setup.id,
    locationCode: setup.LocationCode,
    company: setup.Company,
    schedule: {
      id: setup.schedule_id,
      code: setup.schedule_code,
      description: setup.schedule_description,
      schedule: setup.schedule_schedule,
    },
    tech: {
      id: setup.TechID1,
      code: setup.TechCode,
      name: formatTechName(setup.TechFName, setup.TechLName),
      enforced: true,
    },
    time: {
      range: setup.TimeRange,
      preferred: convertToETTime(setup.WorkTime),
      enforced: true,
      duration: setup.Duration,
    },
    comments: {
      serviceSetup: setup.serviceSetupComments,
      location: setup.locationComments,
    },
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  let ids = searchParams.get('ids')?.split(',') || []

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  }

  let pool
  try {
    console.log('Fetching service setups from database...')
    pool = await sql.connect(config)

    const serviceSetups = await getServiceSetups(pool, ids)

    const transformedSetups = serviceSetups.map(transformServiceSetup)

    return NextResponse.json(transformedSetups)
  } catch (error) {
    console.error('Error fetching from database:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
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
