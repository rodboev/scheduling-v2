'use client'

import { useRef, useEffect, useState } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

/**
 * MapTools provides date selection for services
 */
const MapTools = ({
  date,
  setDate,
  handleNextDay,
  fetchClusteredServices,
  isLoading,
  clearServices,
}) => {
  /**
   * Date handling utilities
   * - Converts between ISO and local date strings
   * - Handles date picker interactions
   */
  const toLocalDateString = isoString => {
    return dayjs(isoString).tz('America/New_York').format('YYYY-MM-DD')
  }

  const handleDateChange = async e => {
    const selectedDate = dayjs.tz(e.target.value, 'America/New_York').startOf('day')
    await setDate(selectedDate.toISOString())
    fetchClusteredServices()
  }

  const dateRef = useRef(null)

  useEffect(() => {
    const openDatePicker = inputRef => {
      if (inputRef.current) {
        inputRef.current.showPicker()
      }
    }

    const handleDateClick = () => openDatePicker(dateRef)

    if (dateRef.current) {
      dateRef.current.addEventListener('click', handleDateClick)
    }

    return () => {
      if (dateRef.current) {
        dateRef.current.removeEventListener('click', handleDateClick)
      }
    }
  }, [])

  const [statusMessage, setStatusMessage] = useState(null)
  const statusTimeoutRef = useRef(null)
  const isRefreshingRef = useRef(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const showStatus = (message, isRefreshing = false) => {
    // Clear any existing timeout
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current)
    }
    setStatusMessage(message)
    isRefreshingRef.current = isRefreshing

    // Set new timeout
    statusTimeoutRef.current = setTimeout(() => {
      setStatusMessage(null)
      isRefreshingRef.current = false
    }, 3000)
  }

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current)
      }
    }
  }, [])

  // Only clear status message when loading state changes if we're not refreshing distances
  useEffect(() => {
    if (isLoading && !isRefreshingRef.current) {
      setStatusMessage(null)
    }
  }, [isLoading])

  const formatStatusDate = date => {
    return dayjs(date).tz('America/New_York').format('M/D')
  }

  const handleRefreshDistances = async () => {
    try {
      setIsRefreshing(true)
      isRefreshingRef.current = true
      setStatusMessage(`Refreshing data for ${formatStatusDate(date)}...`)

      const response = await fetch('/api/distance/refresh')
      const data = await response.json()

      if (data.error) {
        setStatusMessage(`Error refreshing data: ${data.error}`)
      } else {
        // Refetch services to get updated distances
        await fetchClusteredServices()
        // Only show success message after data is refreshed and rendered
        setStatusMessage('Data refreshed successfully')
        // Clear status message after 3 seconds
        setTimeout(() => {
          setStatusMessage('')
        }, 3000)
      }
    } catch (error) {
      console.error('Error refreshing data:', error)
      setStatusMessage('Error refreshing data')
    } finally {
      setIsRefreshing(false)
      isRefreshingRef.current = false
    }
  }

  return (
    <>
      {(isLoading || statusMessage) && (
        <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 transform rounded bg-white px-6 py-2 shadow">
          <p>
            {isLoading && !isRefreshingRef.current
              ? date
                ? `Loading ${formatStatusDate(date)}...`
                : 'Loading...'
              : statusMessage}
          </p>
        </div>
      )}
      <div className="absolute right-4 top-4 z-[1000] space-y-4 overflow-hidden">
        <div className="rounded bg-white p-4 shadow">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label htmlFor="date" className="mb-1 block text-sm font-bold">
                Date:
              </label>
              <input
                id="date"
                ref={dateRef}
                type="date"
                value={toLocalDateString(date)}
                onChange={handleDateChange}
                className="w-full cursor-pointer rounded border p-2"
              />
            </div>
          </div>

          <div className="flex space-x-4">
            <button
              onClick={async () => {
                const newDate = dayjs
                  .tz(date, 'America/New_York')
                  .subtract(1, 'day')
                  .startOf('day')
                  .toISOString()
                await setDate(newDate)
                fetchClusteredServices(newDate)
              }}
              className="leading-tighter mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
              type="button"
            >
              {'<'} Prev day
            </button>

            <button
              onClick={async () => {
                const newDate = dayjs
                  .tz(date, 'America/New_York')
                  .add(1, 'day')
                  .startOf('day')
                  .toISOString()
                await setDate(newDate)
                fetchClusteredServices(newDate)
              }}
              className="leading-tighter mt-4 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold text-blue-600 no-underline hover:bg-blue-600 hover:text-white"
              type="button"
            >
              Next day {'>'}
            </button>
          </div>
        </div>
        <button
          onClick={handleRefreshDistances}
          disabled={isRefreshing}
          className={`leading-tighter relative left-1/2 mt-4 -translate-x-1/2 rounded-md border-4 border-blue-600 bg-white px-4 py-2 font-bold ${
            isRefreshing
              ? 'cursor-not-allowed border-gray-400 text-gray-400'
              : 'text-blue-600 hover:bg-blue-600 hover:text-white'
          }`}
          type="button"
        >
          {isRefreshing ? 'Refreshing data...' : 'Refresh data'}
        </button>
      </div>
    </>
  )
}

export default MapTools
