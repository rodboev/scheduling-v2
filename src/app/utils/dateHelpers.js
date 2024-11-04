import { dayjsInstance as dayjs } from './dayjs.js'

export function formatDate(date) {
  return dayjs(date).format('M/D')
}

export function formatTime(date) {
  return dayjs(date).format('h:mma')
}

export function calculateDuration(start, end) {
  return dayjs(end).diff(dayjs(start), 'hour', true)
}

export function addMinutes(date, minutes) {
  return dayjs(date).add(minutes, 'minute').toDate()
}

export function addHours(date, hours) {
  return dayjs(date).add(hours, 'hour').toDate()
}

export function max(...dates) {
  return new Date(Math.max(...dates.map(d => d.getTime())))
}

export function min(...dates) {
  return new Date(Math.min(...dates.map(d => d.getTime())))
}

export function differenceInHours(dateLeft, dateRight) {
  const diffInMs = Math.abs(dateLeft - dateRight)
  return diffInMs / (1000 * 60 * 60)
}

export function isAfter(date1, date2) {
  return date1.getTime() > date2.getTime()
}

export function isBefore(date1, date2) {
  return date1.getTime() < date2.getTime()
}

export function getMax(date1, date2) {
  return date1.getTime() > date2.getTime() ? date1 : date2
}

export function getMin(date1, date2) {
  return date1.getTime() < date2.getTime() ? date1 : date2
}
