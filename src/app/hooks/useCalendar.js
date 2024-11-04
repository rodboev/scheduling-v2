// src/app/hooks/useCalendar.js
import { useState, useCallback } from 'react'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { Views } from 'react-big-calendar'

export function useCalendar(defaultDate = new Date()) {
  const [date, setDate] = useState(defaultDate)
  const [view, setView] = useState(Views.WEEK)
  const [currentViewRange, setCurrentViewRange] = useState(() => {
    if (view === Views.DAY) {
      return createDateRange(date, date)
    }

    if (view === Views.WEEK) {
      return createDateRange(
        dayjs(date).startOf('week').toDate(),
        dayjs(date).endOf('week').toDate(),
      )
    }

    if (view === Views.MONTH) {
      return createDateRange(
        dayjs(date).startOf('month').toDate(),
        dayjs(date).endOf('month').toDate(),
      )
    }

    return createDateRange(date, date)
  })

  const handleView = useCallback(newView => {
    setView(newView)
  }, [])

  const handleNavigate = useCallback(newDate => {
    setDate(newDate)
    setCurrentViewRange(createDateRange(newDate, newDate))
  }, [])

  const handleRangeChange = useCallback(range => {
    const [start, end] = Array.isArray(range)
      ? [range[0], range[range.length - 1]]
      : [range.start, range.end]
    setCurrentViewRange(createDateRange(start, end))
  }, [])

  return {
    date,
    view,
    currentViewRange,
    handleView,
    handleNavigate,
    handleRangeChange,
  }
}
