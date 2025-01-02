// src/app/hooks/useCalendar.js
import { useState, useCallback } from 'react'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { Views } from 'react-big-calendar'

export function useCalendar(defaultDate = new Date()) {
  const [date, setDate] = useState(defaultDate)
  const [view, setView] = useState(Views.DAY)
  const [currentViewRange, setCurrentViewRange] = useState(() => {
    return createDateRange(
      dayjs(defaultDate).startOf('day').toDate(),
      dayjs(defaultDate).endOf('day').toDate(),
    )
  })

  const handleView = useCallback(
    newView => {
      setView(newView)

      // Update the date range based on the new view
      if (newView === Views.DAY) {
        setCurrentViewRange(createDateRange(date, date))
      } else if (newView === Views.WEEK) {
        setCurrentViewRange(
          createDateRange(dayjs(date).startOf('week').toDate(), dayjs(date).endOf('week').toDate()),
        )
      } else if (newView === Views.MONTH) {
        setCurrentViewRange(
          createDateRange(
            dayjs(date).startOf('month').toDate(),
            dayjs(date).endOf('month').toDate(),
          ),
        )
      }
    },
    [date],
  )

  const handleNavigate = useCallback(
    (newDate, viewType) => {
      setDate(newDate)

      // Update the range based on current view
      if (view === Views.DAY) {
        setCurrentViewRange(createDateRange(newDate, newDate))
      } else if (view === Views.WEEK) {
        setCurrentViewRange(
          createDateRange(
            dayjs(newDate).startOf('week').toDate(),
            dayjs(newDate).endOf('week').toDate(),
          ),
        )
      } else if (view === Views.MONTH) {
        setCurrentViewRange(
          createDateRange(
            dayjs(newDate).startOf('month').toDate(),
            dayjs(newDate).endOf('month').toDate(),
          ),
        )
      }
    },
    [view],
  )

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
