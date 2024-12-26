// src/app/hooks/useCalendar.js
import { useState, useCallback } from 'react'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { Views } from 'react-big-calendar'
import { getDistance } from '@/app/map/utils/distance'

const DEFAULT_TRAVEL_TIME = 15 // Default 15 minutes if no distance info

export function useCalendar(defaultDate = new Date()) {
  const [date, setDate] = useState(defaultDate)
  const [view, setView] = useState(Views.DAY)
  const [currentViewRange, setCurrentViewRange] = useState(() => {
    return createDateRange(defaultDate, defaultDate)
  })

  // Calculate travel time between events based on distance
  const calculateTravelTime = useCallback(async (fromEvent, toEvent) => {
    if (!fromEvent || !toEvent) return DEFAULT_TRAVEL_TIME

    try {
      const distance = await getDistance(fromEvent, toEvent)
      // Ensure minimum 15 minutes travel time
      const calculatedTime = distance ? Math.ceil(distance) : DEFAULT_TRAVEL_TIME
      return Math.max(calculatedTime, DEFAULT_TRAVEL_TIME)
    } catch (error) {
      console.warn('Error calculating distance:', error)
      return DEFAULT_TRAVEL_TIME
    }
  }, [])

  // Adjust event times based on travel time between locations
  const adjustEventTimes = useCallback(
    async events => {
      const adjustedEvents = [...events]

      for (let i = 1; i < adjustedEvents.length; i++) {
        const prevEvent = adjustedEvents[i - 1]
        const currentEvent = adjustedEvents[i]

        // Calculate travel time from previous location
        const travelTime = await calculateTravelTime(prevEvent, currentEvent)

        // Always enforce minimum gap by calculating the required start time
        const requiredStart = dayjs(prevEvent.end).add(travelTime, 'minutes').toDate()

        // Update event times to maintain the gap
        currentEvent.start = requiredStart
        currentEvent.end = dayjs(requiredStart).add(currentEvent.duration, 'minutes').toDate()

        // Add travel time info to the event
        currentEvent.travelTime = travelTime
        currentEvent.distanceFromPrevious = travelTime // For compatibility with MapView display
        currentEvent.previousCompany = prevEvent.company || prevEvent.title
      }

      return adjustedEvents
    },
    [calculateTravelTime],
  )

  const handleView = useCallback(
    newView => {
      setView(newView)

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
    adjustEventTimes,
    calculateTravelTime,
  }
}
