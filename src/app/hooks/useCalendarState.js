// src/app/hooks/useCalendarState.js

import { useState, useCallback } from 'react'
import { Views } from 'react-big-calendar'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { useLocalStorage } from '@/app/hooks/useLocalStorage'

export function useCalendarState() {
  const [date, setDate] = useState(new Date(2024, 8, 2))
  const [view, setView] = useState(Views.DAY)
  const [currentViewRange, setCurrentViewRange] = useState(() => createDateRange(date, date))
  const [enforcedServiceSetups, setEnforcedServiceSetups] = useLocalStorage(
    'enforcedServiceSetups',
    {},
  )

  const handleView = useCallback((newView) => {
    setView(newView)
  }, [])

  const handleNavigate = useCallback((newDate) => {
    setDate(newDate)
    setCurrentViewRange(createDateRange(newDate, newDate))
  }, [])

  const handleRangeChange = useCallback((range) => {
    const [start, end] = Array.isArray(range)
      ? [range[0], range[range.length - 1]]
      : [range.start, range.end]
    setCurrentViewRange(createDateRange(start, end))
  }, [])

  const updateEnforced = useCallback(
    (id, checked) => {
      const setupId = id.includes('-') ? id.split('-')[0] : id
      setEnforcedServiceSetups((prev) => ({
        ...prev,
        [setupId]: checked,
      }))
    },
    [setEnforcedServiceSetups],
  )

  const handleAllServiceSetupsEnforcementChange = useCallback(
    (checked) => {
      setEnforcedServiceSetups((prev) => {
        const newEnforcedServiceSetups = Object.keys(prev).reduce((acc, key) => {
          acc[key] = checked
          return acc
        }, {})
        return newEnforcedServiceSetups
      })
    },
    [setEnforcedServiceSetups],
  )

  return {
    date,
    view,
    currentViewRange,
    enforcedServiceSetups,
    handleView,
    handleNavigate,
    handleRangeChange,
    updateEnforced,
    handleAllServiceSetupsEnforcementChange,
  }
}
