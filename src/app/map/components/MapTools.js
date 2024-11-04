'use client'

import { useRef, useEffect, useState } from 'react'
import { Slider } from '@/app/components/ui/slider'
import { getDefaultDateRange } from '@/app/utils/dates'
import dayjs from 'dayjs'
import NumberInput from './NumberInput'

/**
 * MapTools provides the control panel for clustering and scheduling parameters
 * - `Algorithm` selection (K-means vs DBSCAN)
 * - Cluster size constraints
 * - Date range selection
 * - Distance vs time optimization
 */
const MapTools = ({
  clusterUnclustered,
  setClusterUnclustered,
  minPoints,
  setMinPoints,
  maxPoints,
  setMaxPoints,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  algorithm,
  setAlgorithm,
  handleNextDay,
  onPointsChangeComplete,
  distanceBias,
  setDistanceBias,
  isOptimizing,
  onOptimizationChange,
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

  const toISOString = localString => {
    const date = new Date(localString)
    return date.toISOString()
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

  // Add local state to track the slider value during dragging
  const [localDistanceBias, setLocalDistanceBias] = useState(distanceBias)
  const previousValueRef = useRef(distanceBias)
  const optimizationTimeoutRef = useRef(null)

  // Update local state while dragging
  function handleSliderChange([value]) {
    setLocalDistanceBias(value)
  }

  // Update parent state when dragging ends
  function handleSliderComplete([value]) {
    if (isOptimizing) return

    // Store the previous value before updating
    previousValueRef.current = distanceBias

    // Start optimization
    setDistanceBias(value)

    // Trigger re-fetch with new distance bias
    if (onOptimizationChange) {
      onOptimizationChange(value)
    }

    // Set timeout to revert if optimization takes too long
    optimizationTimeoutRef.current = setTimeout(() => {
      if (isOptimizing) {
        console.log('Optimization timeout - reverting to previous value')
        setDistanceBias(previousValueRef.current)
        setLocalDistanceBias(previousValueRef.current)
      }
    }, 3000)
  }

  // Cleanup timeout on unmount or when optimization state changes
  useEffect(() => {
    if (!isOptimizing && optimizationTimeoutRef.current) {
      clearTimeout(optimizationTimeoutRef.current)
    }
    return () => {
      if (optimizationTimeoutRef.current) {
        clearTimeout(optimizationTimeoutRef.current)
      }
    }
  }, [isOptimizing])

  // Keep local state in sync with parent state
  useEffect(() => {
    setLocalDistanceBias(distanceBias)
  }, [distanceBias])

  // Add useEffect to maintain 10-hour window when startDate changes
  useEffect(() => {
    const endDateTime = new Date(startDate)
    endDateTime.setHours(endDateTime.getHours() + 10)
    setEndDate(endDateTime.toISOString())
  }, [startDate, setEndDate])

  return (
    <div className="h-30 absolute right-4 top-4 z-[1000] overflow-hidden rounded bg-white p-4 shadow">
      {/* Algorithm Selection:b      b xc 
          - K-means: Focuses on geographic clustering
          - DBSCAN: Better handles noise points and irregular clusters */}
      <div className="mb-4">
        <label
          htmlFor="algorithm"
          className="mb-1 block text-sm font-bold"
        >
          Algorithm:
        </label>
        <select
          id="algorithm"
          value={algorithm}
          onChange={e => setAlgorithm(e.target.value)}
          className="w-full rounded border"
          multiple="multiple"
          selected="selected"
          size="1"
          height="100%"
        >
          <option
            value="kmeans"
            className="p-2"
          >
            K-means
          </option>
          {/* <option
            value="dbscan"
            className="p-2"
          >
            DBSCAN
          </option> */}
        </select>
      </div>

      {/* Cluster Size Constraints:
          - Min points: Minimum services per cluster
          - Max points: Maximum services per cluster
          - Ensures reasonable cluster sizes */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label
            htmlFor="minPoints"
            className="mb-1 block text-sm font-bold"
          >
            Min/cluster:
          </label>
          <NumberInput
            id="minPoints"
            value={minPoints}
            onChange={setMinPoints}
            onChangeComplete={onPointsChangeComplete}
            min={2}
            max={maxPoints - 1}
          />
        </div>
        <div>
          <label
            htmlFor="maxPoints"
            className="mb-1 block text-sm font-bold"
          >
            Max/cluster:
          </label>
          <NumberInput
            id="maxPoints"
            value={maxPoints}
            onChange={setMaxPoints}
            onChangeComplete={onPointsChangeComplete}
            min={minPoints + 1}
            max={20}
          />
        </div>
      </div>
      {algorithm === 'dbscan' && (
        <button
          onClick={() => setClusterUnclustered(!clusterUnclustered)}
          className="mt-4 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
          type="button"
        >
          {clusterUnclustered ? 'Uncluster Noise' : 'Cluster Noise'}
        </button>
      )}

      {/* Date Range Selection:
          - Controls the time window for services
          - Enforces minimum 8-hour difference
          - Uses 15-minute increments */}
      <div className="mt-4 grid grid-cols-1 gap-4">
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

      {/* Distance vs Time Priority Slider:
          - 0%: Minimize time gaps between services
          - 100%: Minimize travel distance between locations
          - Affects service ordering within clusters */}
      <div className="mt-4">
        <label
          htmlFor="route-optimization"
          className="mb-1 block text-sm font-bold"
        >
          Route Optimization: {localDistanceBias}%
          {isOptimizing && (
            <span className="ml-2 text-neutral-500">Working...</span>
          )}
        </label>
        <Slider
          id="route-optimization"
          value={[localDistanceBias]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderComplete}
          max={100}
          step={1}
          className={`py-4 ${isOptimizing ? 'opacity-50' : ''}`}
          disabled={isOptimizing}
        />
        <div className="flex justify-between text-sm text-gray-500">
          <span>Minimize Gaps</span>
          <span>&#x2194;</span>
          <span>Minimize Distance</span>
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
    </div>
  )
}

export default MapTools
