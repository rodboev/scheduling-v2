'use client'

import { useRef, useEffect, useState } from 'react'
import { getDefaultDateRange } from '@/app/utils/dates'
import { SHIFT_DURATION_MS, SHIFTS } from '@/app/utils/constants'

/**
 * MapTools provides date range selection for services
 */
const MapTools = ({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  handleNextDay,
  fetchClusteredServices,
  isLoading,
  activeShift,
  setActiveShift,
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

  const handleShiftChange = shift => {
    setActiveShift(shift)
    const currentDate = new Date(startDate)
    const [hours, minutes] = SHIFTS[shift].start.split(':').map(Number)

    // Set the start date to the shift start time
    currentDate.setUTCHours(hours, minutes, 0, 0)
    const newStartDate = currentDate.toISOString()
    setStartDate(newStartDate)

    // Set the end date 8 hours later
    const newEndDate = new Date(currentDate)
    newEndDate.setTime(newEndDate.getTime() + SHIFT_DURATION_MS)
    setEndDate(newEndDate.toISOString())
  }

  const handleDateChange = (e, setter, isStartDate) => {
    const newDate = new Date(e.target.value)

    if (isStartDate) {
      setter(newDate.toISOString())
      // Set end date to shift duration after start date
      const newEndDate = new Date(newDate)
      newEndDate.setTime(newEndDate.getTime() + SHIFT_DURATION_MS)
      setEndDate(newEndDate.toISOString())
    } else {
      setter(newDate.toISOString())
    }
  }

  // Initialize state with default dates if not provided
  useEffect(() => {
    const { start, end } = getDefaultDateRange()
    if (!startDate) {
      setStartDate(start)
      handleShiftChange(1) // Set to shift 1 by default
    }
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

  const formatStatusDate = date => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
    })
  }

  return (
    <div className="absolute right-4 top-4 z-[1000] space-y-4 overflow-hidden">
      {isLoading && (
        <div className="fixed left-1/2 top-4 -translate-x-1/2 transform rounded bg-white px-6 py-2 shadow">
          <p>
            {startDate && activeShift
              ? `Loading ${formatStatusDate(startDate)} shift ${activeShift}...`
              : 'Loading...'}
          </p>
        </div>
      )}
      <div className="flex space-x-4 rounded bg-white p-4 shadow">
        <div className="my-2 text-sm font-bold">Shift:</div>
        {[1, 2, 3].map(shift => (
          <button
            key={shift}
            onClick={() => handleShiftChange(shift)}
            className={`-my-1 rounded-md border-4 border-blue-600 px-4 text-sm font-bold transition-colors ${
              activeShift === shift
                ? 'bg-blue-600 text-white'
                : 'bg-white hover:bg-blue-600 hover:text-white'
            }`}
          >
            {shift}
          </button>
        ))}
      </div>
      <div className="rounded bg-white p-4 shadow">
        {/* Date Range Selection:
          - Controls the time window for services
          - Enforces shift duration window
          - Uses 15-minute increments */}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="startDate" className="mb-1 block text-sm font-bold">
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
            <label htmlFor="endDate" className="mb-1 block text-sm font-bold">
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

        <div className="flex space-x-4">
          <button
            onClick={() => {
              const newStartDate = new Date(startDate)
              newStartDate.setUTCDate(newStartDate.getUTCDate() - 1)
              setStartDate(newStartDate.toISOString())

              const newEndDate = new Date(endDate)
              newEndDate.setUTCDate(newEndDate.getUTCDate() - 1)
              setEndDate(newEndDate.toISOString())
              // fetchClusteredServices will be called by useEffect in MapView
            }}
            className="leading-tighter mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
            type="button"
          >
            Previous day
          </button>

          <button
            onClick={handleNextDay} // handleNextDay already updates the dates, which triggers useEffect
            className="leading-tighter mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
            type="button"
          >
            Next day
          </button>
        </div>
      </div>
      <button
        onClick={async () => {
          try {
            await fetch('/api/distance/refresh', { method: 'POST' })
            if (typeof fetchClusteredServices === 'function') {
              fetchClusteredServices()
            }
          } catch (error) {
            console.error('Failed to refresh distances:', error)
          }
        }}
        className="leading-tighter float-right mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
        type="button"
      >
        Refresh Distance
      </button>
    </div>
  )
}

export default MapTools
