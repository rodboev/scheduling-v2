// src/app/utils/timeRange.js
import {
  dayjsInstance as dayjs,
  secondsSinceMidnight,
  dateFromSecondsSinceMidnight,
} from '@/app/utils/dayjs'

export function formatTime(input) {
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
  }
  return `${hours}:${minutes.toString().padStart(2, '0')}${ampm}`
}

export function formatTimeRange(start, end) {
  const startTime = typeof start === 'number' ? dateFromSecondsSinceMidnight(start) : dayjs(start)
  const endTime = typeof end === 'number' ? dateFromSecondsSinceMidnight(end) : dayjs(end)

  const startFormatted = formatTime(startTime)
  const endFormatted = formatTime(endTime)

  if (startTime.format('a') === endTime.format('a')) {
    return `${startFormatted.slice(0, -2)}-${endFormatted}`
  }
  return `${startFormatted}-${endFormatted}`
}

export function parseTime(timeStr, defaultPeriod = null) {
  if (!timeStr || typeof timeStr !== 'string') return null

  let time = timeStr.trim().toUpperCase()

  // Identify and handle AM/PM suffixes first
  let period = defaultPeriod
  if (time.includes('P') && !time.includes('PM')) {
    time = time.replace('P', ' PM')
  }
  if (time.includes('A') && !time.includes('AM')) {
    time = time.replace('A', ' AM')
  }

  if (time.endsWith('PM')) {
    period = 'PM'
    time = time.slice(0, -2)
  } else if (time.endsWith('AM')) {
    period = 'AM'
    time = time.slice(0, -2)
  }

  // Remove all non-numeric characters now that period is extracted
  time = time.replace(/[^0-9]/g, '')

  let hours
  let minutes
  if (time.length === 3) {
    // e.g., '745' -> '7:45'
    hours = Number.parseInt(time.slice(0, 1), 10)
    minutes = Number.parseInt(time.slice(1), 10)
  } else if (time.length === 4) {
    // e.g., '1045' -> '10:45'
    hours = Number.parseInt(time.slice(0, 2), 10)
    minutes = Number.parseInt(time.slice(2), 10)
  } else {
    hours = Number.parseInt(time, 10)
    minutes = 0
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    // console.error(`Invalid time format: '${time}'`)
    return null
  }

  // Adjust hours for AM/PM
  if (hours === 12) hours = 0 // Midnight or noon should be 0 in 24-hour format
  if (period === 'PM' && hours !== 12) hours += 12

  const totalSeconds = hours * 3600 + minutes * 60

  if (totalSeconds >= 86400) {
    // console.error(`Invalid time '${time}' calculated to ${totalSeconds}: exceeds 24 hours.`)
    return null
  }

  return totalSeconds
}

export function parseTimeRange(timeRangeStr) {
  // Return null range for invalid input
  if (!timeRangeStr || typeof timeRangeStr !== 'string') {
    return [null, null]
  }

  // Handle "ANY" time range
  if (timeRangeStr.trim().toUpperCase() === 'ANY') {
    return [0, 86400] // 24 hours in seconds
  }

  const parts = timeRangeStr.split('-')

  // Handle single time input (e.g. "9:00am")
  if (parts.length === 1) {
    const startTime = parseTime(parts[0].trim())
    if (startTime === null) {
      return [null, null]
    }
    return [startTime, startTime]
  }

  // Handle time range input (e.g. "9:00am-5:00pm")
  const [startTime, endTime] = parseTimeRangeInterval(timeRangeStr)
  if (startTime === null || endTime === null) {
    return [null, null]
  }

  return [startTime, endTime]
}

export const parseTimeRangeInterval = memoize(timeRangeStr => {
  if (!timeRangeStr || typeof timeRangeStr !== 'string') {
    return [null, null]
  }

  const parts = timeRangeStr.split('-').map(part => part.trim())

  if (parts.length !== 2) {
    return [null, null]
  }

  const [startStr, endStr] = parts

  // Determine if the time strings contain period indicators
  const startHasPeriod =
    startStr.toUpperCase().includes('A') || startStr.toUpperCase().includes('P')
  const endHasPeriod = endStr.toUpperCase().includes('A') || endStr.toUpperCase().includes('P')

  // If the end time has a period and the start time does not, use the end time's period for the start time
  const defaultPeriod =
    !startHasPeriod && endHasPeriod ? (endStr.toUpperCase().includes('P') ? 'PM' : 'AM') : 'AM'

  // Parse start and end times with the determined default period
  let startTime = parseTime(startStr, defaultPeriod)
  let endTime = parseTime(endStr, 'AM')

  if (startTime === null || endTime === null) {
    return [null, null]
  }

  // Check for invalid period combinations
  if (startHasPeriod && endHasPeriod) {
    const startPeriod = startStr.toUpperCase().includes('P') ? 'PM' : 'AM'
    const endPeriod = endStr.toUpperCase().includes('P') ? 'PM' : 'AM'
    if (startPeriod === endPeriod && endTime <= startTime) {
      return [null, null]
    }
  }

  // If end time is earlier than start time, it means the service spans across midnight
  if (endTime <= startTime) {
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
})

export const memoizedParseTimeRange = parseTimeRange

function memoize(fn) {
  const cache = new Map()
  return function (...args) {
    const key = JSON.stringify(args)
    if (cache.has(key)) {
      return cache.get(key)
    }
    const result = fn.apply(this, args)
    cache.set(key, result)
    return result
  }
}

export function round(time) {
  if (!time) return null
  const minutes = time.minute()
  const roundedMinutes = Math.round(minutes / 15) * 15
  return time.minute(roundedMinutes).second(0).millisecond(0)
}
