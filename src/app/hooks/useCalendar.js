// src/app/hooks/useCalendar.js
import { useState, useCallback } from 'react'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { Views } from 'react-big-calendar'

export function useCalendar() {
  const [date, setDate] = useState(new Date(2024, 8, 2))
  const [view, setView] = useState(Views.DAY)
  const [currentViewRange, setCurrentViewRange] = useState(() => createDateRange(date, date))

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
