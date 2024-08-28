// test.js

const sql = require('mssql/msnodesqlv8.js')
const dotenv = require('dotenv')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const dayOfYear = require('dayjs/plugin/dayOfYear')
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(dayOfYear)
dayjs.extend(isSameOrBefore)

dotenv.config()

// Utility functions
function convertToETTime(timeString) {
  if (!timeString) return null

  const time = dayjs(timeString).utc()
  const hours = time.hour()
  const minutes = time.minute()
  const today = dayjs().tz('America/New_York').startOf('day')
  const etDate = today.hour(hours).minute(minutes)

  return etDate.format('h:mm A')
}

function parseTime(timeStr, defaultPeriod = null) {
  timeStr = timeStr.trim().toUpperCase()

  // Identify and handle AM/PM suffixes first
  let period = defaultPeriod
  if (timeStr.includes('P') && !timeStr.includes('PM')) {
    timeStr = timeStr.replace('P', ' PM')
  }
  if (timeStr.includes('A') && !timeStr.includes('AM')) {
    timeStr = timeStr.replace('A', ' AM')
  }

  if (timeStr.endsWith('PM')) {
    period = 'PM'
    timeStr = timeStr.slice(0, -2)
  } else if (timeStr.endsWith('AM')) {
    period = 'AM'
    timeStr = timeStr.slice(0, -2)
  }

  // Remove all non-numeric characters now that period is extracted
  timeStr = timeStr.replace(/[^0-9]/g, '')

  let hours, minutes
  if (timeStr.length === 3) {
    // e.g., '745' -> '7:45'
    hours = parseInt(timeStr.slice(0, 1), 10)
    minutes = parseInt(timeStr.slice(1), 10)
  } else if (timeStr.length === 4) {
    // e.g., '1045' -> '10:45'
    hours = parseInt(timeStr.slice(0, 2), 10)
    minutes = parseInt(timeStr.slice(2), 10)
  } else {
    hours = parseInt(timeStr, 10)
    minutes = 0
  }

  if (isNaN(hours) || isNaN(minutes)) {
    // console.error(`Invalid time format: '${timeStr}'`)
    return null
  }

  // Adjust hours for AM/PM
  if (hours === 12) hours = 0 // Midnight or noon should be 0 in 24-hour format
  if (period === 'PM' && hours != 12) hours += 12

  const totalSeconds = hours * 3600 + minutes * 60

  if (totalSeconds >= 86400) {
    // console.error(`Invalid time '${timeStr}' calculated to ${totalSeconds}: exceeds 24 hours.`)
    return null
  }

  return totalSeconds
}

function parseTimeRange(timeRangeStr, duration) {
  if (!timeRangeStr || typeof timeRangeStr !== 'string') {
    // console.error(`Invalid timeRangeStr: ${timeRangeStr}`)
    return [null, null]
  }

  // console.log(`Parsing time range: ${timeRangeStr}`)
  let [startTime, endTime] = parseTimeRangeInterval(timeRangeStr)
  if (startTime === null || endTime === null) {
    return [null, null]
  }

  // Add duration to endTime
  endTime += duration * 60 // Convert duration from minutes to seconds

  // If endTime exceeds 24 hours, wrap it around
  if (endTime >= 86400) {
    endTime %= 86400
  }

  return [startTime, endTime]
}

function parseTimeRangeInterval(timeRangeStr) {
  if (!timeRangeStr || typeof timeRangeStr !== 'string') {
    // console.error(`Invalid timeRangeStr: ${timeRangeStr}`)
    return [null, null]
  }

  const parts = timeRangeStr.split('-')
  if (parts.length !== 2) {
    // console.error(`Invalid time range format: ${timeRangeStr}`)
    return [null, null]
  }

  const [startStr, endStr] = parts.map((str) => str.trim())

  // Determine if the time strings contain period indicators
  const startHasPeriod =
    startStr.toUpperCase().includes('A') || startStr.toUpperCase().includes('P')
  const endHasPeriod = endStr.toUpperCase().includes('A') || endStr.toUpperCase().includes('P')

  // If the end time has a period and the start time does not, use the end time's period for the start time
  let defaultPeriod
  if (!startHasPeriod && endHasPeriod) {
    defaultPeriod = endStr.toUpperCase().includes('P') ? 'PM' : 'AM'
  } else {
    defaultPeriod = 'AM'
  }

  // Parse start and end times with the determined default period
  let startTime = parseTime(startStr, defaultPeriod)
  let endTime = parseTime(endStr, 'AM')

  if (startTime === null || endTime === null) {
    console.error(`Error parsing time range: '${timeRangeStr}'`)
    return [null, null]
  }

  // Check for invalid period combinations
  if (startHasPeriod && endHasPeriod) {
    const startPeriod = startStr.toUpperCase().includes('P') ? 'PM' : 'AM'
    const endPeriod = endStr.toUpperCase().includes('P') ? 'PM' : 'AM'
    if (startPeriod === endPeriod && endTime <= startTime) {
      // console.error(`Invalid time range: '${timeRangeStr}'`)
      return [null, null]
    }
  }

  // If end time is earlier than start time, it means the service spans across midnight
  if (endTime <= startTime) {
    // Special handling for cases where end time is AM and earlier than start time
    if (
      endStr.toUpperCase().includes('A') &&
      !startStr.toUpperCase().includes('AM') &&
      !startStr.toUpperCase().includes('PM')
    ) {
      startTime = parseTime(startStr, 'PM')
    } else if (endStr.toUpperCase().includes('P') && !startStr.toUpperCase().includes('PM')) {
      startTime = parseTime(startStr, 'AM')
    }
    endTime += 24 * 60 * 60 // Add 24 hours in seconds
  }

  return [startTime, endTime]
}

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
    id: setup.SetupID,
    locationCode: setup.LocationCode,
    company: setup.Company,
    schedule: {
      id: setup.ScheduleID,
      code: setup.ScheduleCode,
      description: setup.ScheduleDescription,
      string: setup.ScheduleString,
      schedule: setup.ScheduleString,
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

async function getServiceSetupsForSeptember2() {
  let pool
  try {
    pool = await sql.connect(config)

    const query = `
      SELECT 
        ServiceSetups.SetupID,
        ServiceSetups.LocationID,
        ServiceSetups.ServiceCode,
        ServiceSetups.ScheduleID,
        ServiceSetups.TechID1,
        ServiceSetups.WorkTime,
        ServiceSetups.TimeRange,
        ServiceSetups.Duration,
        ServiceSetups.Comment AS ServiceSetupComment,
        Locations.Company,
        Locations.LocationCode,
        Locations.Comment AS LocationComment,
        Schedules.Code AS ScheduleCode,
        Schedules.Description AS ScheduleDescription,
        Schedules.Schedule AS ScheduleString,
        Technicians.Code AS TechCode,
        Technicians.FName AS TechFName,
        Technicians.LName AS TechLName
      FROM 
        ServiceSetups
      JOIN 
        Locations ON ServiceSetups.LocationID = Locations.LocationID
      JOIN 
        Schedules ON ServiceSetups.ScheduleID = Schedules.ScheduleID
      LEFT JOIN
        Technicians ON ServiceSetups.TechID1 = Technicians.TechID
      WHERE 
        ServiceSetups.Active = 1;
    `

    const result = await pool.request().query(query)
    const allServiceSetups = result.recordset

    // Calculate the day of the year for September 2, 2024
    const targetDate = dayjs('2024-09-02')
    const dayOfYear = targetDate.dayOfYear()

    // Filter service setups for September 2, 2024
    const september2Setups = allServiceSetups.filter((setup) => {
      const scheduleArray = setup.ScheduleString.split('')
      return scheduleArray[dayOfYear] === '1'
    })

    const transformedSetups = september2Setups.map(transformServiceSetup)

    console.log(`Found ${transformedSetups.length} service setups for September 2, 2024:`)
    console.log(JSON.stringify(transformedSetups, null, 2))

    return transformedSetups
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error
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

getServiceSetupsForSeptember2().catch(console.error)
