import { Views } from 'react-big-calendar'
import { dayjsInstance as dayjs } from './dayjs.js'

// Create date localizer for react-big-calendar
const dayjsLocalizer = {
  formats: {
    dateFormat: 'DD',
    dayFormat: 'DD ddd',
    weekdayFormat: 'ddd',
    monthHeaderFormat: 'MMMM YYYY',
    dayHeaderFormat: 'dddd MMM DD',
    dayRangeHeaderFormat: ({ start, end }) =>
      `${dayjs(start).format('MMM DD')} - ${dayjs(end).format('MMM DD, YYYY')}`,
    timeGutterFormat: 'h:mm A',
    agendaDateFormat: 'ddd MMM DD',
    agendaTimeFormat: 'h:mm A',
    agendaTimeRangeFormat: ({ start, end }) =>
      `${dayjs(start).format('h:mm A')} - ${dayjs(end).format('h:mm A')}`,
  },

  firstOfWeek() {
    return dayjs().startOf('week').day()
  },

  range(start, end) {
    const current = dayjs(start).startOf('day')
    const last = dayjs(end).startOf('day')
    const range = []

    while (current.isBefore(last) || current.isSame(last, 'day')) {
      range.push(current.toDate())
      current.add(1, 'day')
    }

    return range
  },

  navigate(date, action) {
    const d = dayjs(date)
    switch (action) {
      case 'PREV':
        return d.subtract(1, 'month').toDate()
      case 'NEXT':
        return d.add(1, 'month').toDate()
      case 'TODAY':
        return new Date()
      default:
        return date
    }
  },

  startOf(date, unit) {
    return dayjs(date).startOf(unit).toDate()
  },

  endOf(date, unit) {
    return dayjs(date).endOf(unit).toDate()
  },

  add(date, amount, unit) {
    return dayjs(date).add(amount, unit).toDate()
  },

  subtract(date, amount, unit) {
    return dayjs(date).subtract(amount, unit).toDate()
  },

  format(date, format) {
    return dayjs(date).format(format)
  },

  lt(a, b) {
    return dayjs(a).isBefore(dayjs(b))
  },

  lte(a, b) {
    return dayjs(a).isSameOrBefore(dayjs(b))
  },

  gt(a, b) {
    return dayjs(a).isAfter(dayjs(b))
  },

  gte(a, b) {
    return dayjs(a).isSameOrAfter(dayjs(b))
  },

  eq(a, b) {
    return dayjs(a).isSame(dayjs(b))
  },

  neq(a, b) {
    return !dayjs(a).isSame(dayjs(b))
  },

  inRange(day, start, end) {
    return dayjs(day).isBetween(start, end, null, '[]')
  },

  min(...dates) {
    return new Date(Math.min(...dates.map(d => d.getTime())))
  },

  max(...dates) {
    return new Date(Math.max(...dates.map(d => d.getTime())))
  },

  merge(date, time) {
    if (!date) return null
    if (!time) return date

    const d = dayjs(date)
    const t = dayjs(time)

    return d
      .hour(t.hour())
      .minute(t.minute())
      .second(t.second())
      .millisecond(t.millisecond())
      .toDate()
  },

  diff(a, b, unit) {
    return dayjs(a).diff(dayjs(b), unit)
  },
}

export { dayjsLocalizer }
