// src/app/utils/timeRange.js

import {
  dayjsInstance as dayjs,
  secondsSinceMidnight,
  dateFromSecondsSinceMidnight,
} from '@/app/utils/dayjs'

function formatTime(input) {
  let date
  if (typeof input === 'number') {
    date = dateFromSecondsSinceMidnight(input)
  } else {
    date = dayjs(input)
  }

  const hours = date.hour() % 12 || 12
  const minutes = date.minute()
  const ampm = date.format('a')

  if (minutes === 0) {
    return `${hours}${ampm}`
  } else {
    return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`
  }
}

export function formatTimeRange(start, end) {
  const startTime = typeof start === 'number' ? dateFromSecondsSinceMidnight(start) : dayjs(start)
  const endTime = typeof end === 'number' ? dateFromSecondsSinceMidnight(end) : dayjs(end)

  const startFormatted = formatTime(startTime)
  const endFormatted = formatTime(endTime)

  if (startTime.format('a') === endTime.format('a')) {
    return `${startFormatted.slice(0, -2)}-${endFormatted}`
  } else {
    return `${startFormatted}-${endFormatted}`
  }
}

export function parseTime(timeStr, defaultPeriod = null) {
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

export function parseTimeRange(timeRangeStr, duration) {
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

export function parseTimeRangeInterval(timeRangeStr) {
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
    console.log(`Error parsing time range: '${timeRangeStr}'`)
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
