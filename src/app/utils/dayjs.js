// src/app/utils/dayjs.js
import dayjs from 'dayjs'
import dayOfYear from 'dayjs/plugin/dayOfYear.js'
import duration from 'dayjs/plugin/duration.js'
import isBetween from 'dayjs/plugin/isBetween.js'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js'
import minMax from 'dayjs/plugin/minMax.js'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(dayOfYear)
dayjs.extend(isSameOrBefore)
dayjs.extend(isSameOrAfter)
dayjs.extend(isBetween)
dayjs.extend(minMax)
dayjs.extend(duration)

export const dayjsInstance = dayjs

// Set the default timezone to 'America/New_York'
dayjs.tz.setDefault('America/New_York')

export const startOfDay = date =>
  dayjs(date).tz('America/New_York').startOf('day')
export const endOfDay = date => dayjs(date).tz('America/New_York').endOf('day')

export function convertToETTime(timeString) {
  if (!timeString) return null
  return dayjs(timeString)
    .tz('America/New_York')
    .add(5, 'hours')
    .format('h:mma')
}

export function createDateRange(start, end) {
  return {
    start: startOfDay(start).toDate(),
    end: endOfDay(end).toDate(),
  }
}

export function secondsSinceMidnight(date) {
  const midnight = startOfDay(date)
  return dayjs(date).diff(midnight, 'second')
}

export function dateFromSecondsSinceMidnight(seconds) {
  return startOfDay().add(seconds, 'second')
}

export function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}
