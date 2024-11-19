import { Views, dayjsLocalizer as createDayjsLocalizer } from 'react-big-calendar'
import { dayjsInstance as dayjs } from './dayjs.js'

const localizer = {
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

  // Required methods for react-big-calendar
  firstVisibleDay: date => dayjs(date).startOf('month').startOf('week').toDate(),
  lastVisibleDay: date => dayjs(date).endOf('month').endOf('week').toDate(),
  getSlotDate: (date, step) => dayjs(date).add(step, 'minutes').toDate(),
  getTotalMin: (start, end) => {
    if (!start || !end) return 0
    return dayjs(end).diff(start, 'minutes')
  },
  getMinutesFromMidnight: date => {
    if (!date) return 0
    const midnight = dayjs(date).startOf('day')
    return dayjs(date).diff(midnight, 'minutes')
  },

  // Existing methods with added safety checks
  startOfWeek() {
    return dayjs().startOf('week').day()
  },

  range(start, end) {
    if (!start || !end) return []
    let current = dayjs(start).startOf('day')
    const last = dayjs(end).startOf('day')
    const range = []

    while (current.isBefore(last) || current.isSame(last, 'day')) {
      range.push(current.toDate())
      current = current.add(1, 'day')
    }

    return range
  },

  navigate(date, action) {
    if (!date) return new Date()
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
    if (!date || !unit) return new Date()
    return dayjs(date).startOf(unit).toDate()
  },

  endOf(date, unit) {
    if (!date || !unit) return new Date()
    return dayjs(date).endOf(unit).toDate()
  },

  add(date, amount, unit) {
    if (!date || amount == null || !unit) return date
    return dayjs(date).add(amount, unit).toDate()
  },

  subtract(date, amount, unit) {
    if (!date || amount == null || !unit) return date
    return dayjs(date).subtract(amount, unit).toDate()
  },

  format(date, formatStr) {
    // Handle cases where format is not a string or date is invalid
    if (!date) return ''
    if (!formatStr || typeof formatStr !== 'string') return dayjs(date).format('YYYY-MM-DD')
    try {
      return dayjs(date).format(formatStr)
    } catch (error) {
      console.error('Format error:', error)
      return dayjs(date).format('YYYY-MM-DD')
    }
  },

  lt(a, b) {
    if (!a || !b) return false
    return dayjs(a).isBefore(dayjs(b))
  },

  lte(a, b) {
    if (!a || !b) return false
    return dayjs(a).isSameOrBefore(dayjs(b))
  },

  gt(a, b) {
    if (!a || !b) return false
    return dayjs(a).isAfter(dayjs(b))
  },

  gte(a, b) {
    if (!a || !b) return false
    return dayjs(a).isSameOrAfter(dayjs(b))
  },

  eq(a, b) {
    if (!a || !b) return false
    return dayjs(a).isSame(dayjs(b))
  },

  neq(a, b) {
    if (!a || !b) return true
    return !dayjs(a).isSame(dayjs(b))
  },

  inRange(day, start, end) {
    if (!day || !start || !end) return false
    return dayjs(day).isBetween(start, end, null, '[]')
  },

  min(...dates) {
    if (!dates.length) return new Date()
    return new Date(Math.min(...dates.filter(Boolean).map(d => d.getTime())))
  },

  max(...dates) {
    if (!dates.length) return new Date()
    return new Date(Math.max(...dates.filter(Boolean).map(d => d.getTime())))
  },

  merge(date, time) {
    if (!date) return null
    if (!time) return date

    try {
      const d = dayjs(date)
      const t = dayjs(time)

      return d
        .hour(t.hour())
        .minute(t.minute())
        .second(t.second())
        .millisecond(t.millisecond())
        .toDate()
    } catch (error) {
      console.error('Merge error:', error)
      return date
    }
  },

  diff(a, b, unit) {
    if (!a || !b || !unit) return 0
    return dayjs(a).diff(dayjs(b), unit)
  },

  visibleDays(date) {
    if (!date) return []
    return this.range(
      this.firstVisibleDay(date),
      this.lastVisibleDay(date)
    )
  },

  getTimezoneOffset() {
    return new Date().getTimezoneOffset()
  },

  startOfWeek(date) {
    if (!date) return new Date()
    return dayjs(date).startOf('week').toDate()
  },

  endOfWeek(date) {
    if (!date) return new Date()
    return dayjs(date).endOf('week').toDate()
  },

  getWeek(date) {
    if (!date) return 1
    return dayjs(date).week()
  },

  getMonth(date) {
    if (!date) return 0
    return dayjs(date).month()
  },

  getYear(date) {
    if (!date) return new Date().getFullYear()
    return dayjs(date).year()
  }
}

// Create the localizer using react-big-calendar's factory function
export const dayjsLocalizer = createDayjsLocalizer(dayjs, localizer)
