'use client'

import { useRef, useEffect } from 'react'
import { getDefaultDateRange } from '@/app/utils/dates'

/**
 * MapTools provides date range selection for services
 */
const MapTools = ({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  handleNextDay,
}) => {
  /**
   * Date handling utilities
   * - Converts between ISO and local datetime strings
   * - Ensures minimum time difference between start/end
   * - Handles datetime picker interactions
   */
  const toLocalDateTimeString = isoString => {
    const date = new Date(isoString)
    return date
      .toLocaleString('sv-SE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      .replace(' ', 'T')
  }

  const handleDateChange = (e, setter, isStartDate) => {
    const newDate = new Date(e.target.value)

    if (isStartDate) {
      setter(newDate.toISOString())
      // Set end date to 10 hours after start date
      const newEndDate = new Date(newDate)
      newEndDate.setHours(newEndDate.getHours() + 10)
      setEndDate(newEndDate.toISOString())
    } else {
      setter(newDate.toISOString())
    }
  }

  // Initialize state with default dates if not provided
  useEffect(() => {
    const { start, end } = getDefaultDateRange()
    if (!startDate) setStartDate(start)
    if (!endDate) setEndDate(end)
  }, [startDate, endDate, setStartDate, setEndDate])

  const startDateRef = useRef(null)
  const endDateRef = useRef(null)

  useEffect(() => {
    const openDatePicker = inputRef => {
      if (inputRef.current) {
        inputRef.current.showPicker()
      }
    }

    const handleStartDateClick = () => openDatePicker(startDateRef)
    const handleEndDateClick = () => openDatePicker(endDateRef)

    if (startDateRef.current) {
      startDateRef.current.addEventListener('click', handleStartDateClick)
    }
    if (endDateRef.current) {
      endDateRef.current.addEventListener('click', handleEndDateClick)
    }

    return () => {
      if (startDateRef.current) {
        startDateRef.current.removeEventListener('click', handleStartDateClick)
      }
      if (endDateRef.current) {
        endDateRef.current.removeEventListener('click', handleEndDateClick)
      }
    }
  }, [])

  // Add useEffect to maintain 10-hour window when startDate changes
  useEffect(() => {
    const endDateTime = new Date(startDate)
    endDateTime.setHours(endDateTime.getHours() + 10)
    setEndDate(endDateTime.toISOString())
  }, [startDate, setEndDate])

  return (
    <div className="absolute right-4 top-4 z-[1000] overflow-hidden rounded bg-white p-4 shadow">
      {/* Date Range Selection:
          - Controls the time window for services
          - Enforces 10-hour window
          - Uses 15-minute increments */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label
            htmlFor="startDate"
            className="mb-1 block text-sm font-bold"
          >
            Start Date:
          </label>
          <input
            id="startDate"
            ref={startDateRef}
            type="datetime-local"
            value={toLocalDateTimeString(startDate)}
            onChange={e => handleDateChange(e, setStartDate, true)}
            className="w-full cursor-pointer rounded border p-2"
            step="900" // 15 minutes in seconds
          />
        </div>
        <div>
          <label
            htmlFor="endDate"
            className="mb-1 block text-sm font-bold"
          >
            End Date:
          </label>
          <input
            id="endDate"
            disabled
            ref={endDateRef}
            type="datetime-local"
            value={toLocalDateTimeString(endDate)}
            onChange={e => handleDateChange(e, setEndDate, false)}
            className="w-full cursor-pointer rounded border p-2 text-gray-500"
            step="900" // 15 minutes in seconds
          />
        </div>
      </div>

      <button
        onClick={handleNextDay}
        className="leading-tighter mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2
          font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
        type="button"
      >
        Next day
      </button>
    </div>
  )
}

export default MapTools
