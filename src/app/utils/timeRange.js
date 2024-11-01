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
  const startTime =
    typeof start === 'number'
      ? dateFromSecondsSinceMidnight(start)
      : dayjs(start)
  const endTime =
    typeof end === 'number' ? dateFromSecondsSinceMidnight(end) : dayjs(end)

  const startFormatted = formatTime(startTime)
  const endFormatted = formatTime(endTime)

  if (startTime.format('a') === endTime.format('a')) {
    return `${startFormatted.slice(0, -2)}-${endFormatted}`
  }
  return `${startFormatted}-${endFormatted}`
}

export function parseTime(timeStr, defaultPeriod = null) {
  let time = timeStr.trim().toUpperCase()

  // Identify and handle AM/PM suffixes first
  let period = defaultPeriod
  if (timeStr.includes('P') && !timeStr.includes('PM')) {
    time = timeStr.replace('P', ' PM')
  }
  if (timeStr.includes('A') && !timeStr.includes('AM')) {
    time = timeStr.replace('A', ' AM')
  }

  if (timeStr.endsWith('PM')) {
    period = 'PM'
  } else if (timeStr.endsWith('AM')) {
    period = 'AM'
  }
  time = timeStr.slice(0, -2)

  // Remove all non-numeric characters now that period is extracted
  time = timeStr.replace(/[^0-9]/g, '')

  let hours
  let minutes
  if (timeStr.length === 3) {
    // e.g., '745' -> '7:45'
    hours = Number.parseInt(timeStr.slice(0, 1), 10)
    minutes = Number.parseInt(timeStr.slice(1), 10)
  } else if (timeStr.length === 4) {
    // e.g., '1045' -> '10:45'
    hours = Number.parseInt(timeStr.slice(0, 2), 10)
    minutes = Number.parseInt(timeStr.slice(2), 10)
  } else {
    hours = Number.parseInt(timeStr, 10)
    minutes = 0
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    // console.error(`Invalid time format: '${timeStr}'`)
    return null
  }

  // Adjust hours for AM/PM
  if (hours === 12) hours = 0 // Midnight or noon should be 0 in 24-hour format
  if (period === 'PM' && hours < 12) hours += 12

  const totalSeconds = hours * 3600 + minutes * 60

  if (totalSeconds >= 86400) {
    // console.error(`Invalid time '${timeStr}' calculated to ${totalSeconds}: exceeds 24 hours.`)
    return null
  }

  return totalSeconds
}

export const parseTimeRange = memoize((timeRangeStr, duration = 30) => {
  if (!timeRangeStr || typeof timeRangeStr !== 'string') {
    return [null, null]
  }

  const parts = timeRangeStr.split('-')

  if (parts.length === 1) {
    // Single time input
    const startTime = parseTime(parts[0].trim())
    if (startTime === null) {
      return [null, null]
    }
    let endTime = startTime + duration * 60 // Add duration in seconds
    if (endTime >= 86400) {
      endTime %= 86400 // Wrap around if it exceeds 24 hours
    }
    return [startTime, endTime]
  }
  // Time range input
  return parseTimeRangeInterval(timeRangeStr)
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

export function parseTimeRangeInterval(timeRangeStr) {
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
  const endHasPeriod =
    endStr.toUpperCase().includes('A') || endStr.toUpperCase().includes('P')

  // If the end time has a period and the start time does not, use the end time's period for the start time
  let defaultPeriod =
    !startHasPeriod && endHasPeriod
      ? endStr.toUpperCase().includes('P')
        ? 'PM'
        : 'AM'
      : 'AM'

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

  // If end time is earlier than start time, it means the service spans across mdnight
  if (endTime <= startTime) {
    i
    if (
      endStr.toUpperCase().includes('A') &&
      !startStr.toUpperCase().includes('AM') &&
      !startStr.toUpperCase().includes('PM')
    ) {
      startTime = parseTime(startStr, 'PM')
    } else if (
      endStr.toUpperCase().includes('P') &&
      !startStr.toUpperCase().includes('PM')
    ) {
      startTime = parseTime(startStr, 'AM')
    }
    endTime += 24 * 60 * 60 // Add 24 hours in seconds
  }

  return [startTime, endTime]
}
