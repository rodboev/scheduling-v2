import { dayjsInstance as dayjs } from './dayjs.js'

export const dayjsLocalizer = {
  formats: {
    dateFormat: 'D',
    dayFormat: 'D ddd',
    monthHeaderFormat: 'MMMM YYYY',
    dayHeaderFormat: 'dddd MMM D',
    dayRangeHeaderFormat: ({ start, end }) =>
      `${dayjs(start).format('MMM D')} - ${dayjs(end).format('MMM D, YYYY')}`,
    timeGutterFormat: 'h:mm A',
    eventTimeRangeFormat: ({ start, end }) =>
      `${dayjs(start).format('h:mm A')} - ${dayjs(end).format('h:mm A')}`,
    agendaDateFormat: 'ddd MMM D',
    agendaTimeFormat: 'h:mm A',
    agendaTimeRangeFormat: ({ start, end }) =>
      `${dayjs(start).format('h:mm A')} - ${dayjs(end).format('h:mm A')}`,
  },

  propType: {},

  startOfWeek: () => {
    return dayjs().startOf('week').day()
  },

  getRange: (start, end) => {
    let current = dayjs(start).startOf('day')
    const endDate = dayjs(end).startOf('day')
    const range = []

    while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
      range.push(current.toDate())
      current = current.add(1, 'day')
    }

    return range
  },

  navigate: (date, action) => {
    switch (action) {
      case 'PREV':
        return dayjs(date).subtract(1, 'month').toDate()
      case 'NEXT':
        return dayjs(date).add(1, 'month').toDate()
      case 'TODAY':
        return new Date()
      default:
        return date
    }
  },

  getDateInfo: date => {
    const d = dayjs(date)
    return {
      firstOfMonth: d.startOf('month').toDate(),
      lastOfMonth: d.endOf('month').toDate(),
      firstOfWeek: d.startOf('week').toDate(),
      lastOfWeek: d.endOf('week').toDate(),
      firstOfDay: d.startOf('day').toDate(),
      lastOfDay: d.endOf('day').toDate(),
    }
  },

  merge: (date, time) => {
    if (!date && !time) return null
    const d = dayjs(date)
    const t = dayjs(time)
    return d
      .hour(t.hour())
      .minute(t.minute())
      .second(t.second())
      .millisecond(t.millisecond())
      .toDate()
  },

  inRange: (date, start, end) => {
    const d = dayjs(date)
    return d.isBetween(start, end, null, '[]')
  },

  eq: (a, b) => {
    return dayjs(a).isSame(dayjs(b))
  },

  neq: (a, b) => {
    return !dayjs(a).isSame(dayjs(b))
  },

  gt: (a, b) => {
    return dayjs(a).isAfter(dayjs(b))
  },

  lt: (a, b) => {
    return dayjs(a).isBefore(dayjs(b))
  },

  gte: (a, b) => {
    return dayjs(a).isSameOrAfter(dayjs(b))
  },

  lte: (a, b) => {
    return dayjs(a).isSameOrBefore(dayjs(b))
  },

  min: (...dates) => {
    return dayjs.min(dates.map(d => dayjs(d))).toDate()
  },

  max: (...dates) => {
    return dayjs.max(dates.map(d => dayjs(d))).toDate()
  },

  diff: (a, b, unit) => {
    return dayjs(a).diff(dayjs(b), unit)
  },
}
