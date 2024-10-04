'use client'

import { useRef, useEffect } from 'react'
import NumberInput from './NumberInput'

const MapTools = ({
  clusterUnclustered,
  setClusterUnclustered,
  maxPoints,
  setMaxPoints,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  algorithm,
  setAlgorithm,
}) => {
  // Convert ISO string to local datetime string
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

  // Convert local datetime string to ISO string
  const toISOString = localString => {
    const date = new Date(localString)
    return date.toISOString()
  }

  const handleDateChange = (e, setter) => {
    const isoString = toISOString(e.target.value)
    setter(isoString)
  }

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

  return (
    <div className="absolute right-4 top-4 z-[1000] rounded bg-white p-4 shadow">
      <div className="mb-4 flex">
        <div className="w-1/2 pr-2">
          <label className="mb-1 block text-sm font-bold">Algorithm:</label>
          <select
            value={algorithm}
            onChange={e => setAlgorithm(e.target.value)}
            className="w-full overflow-hidden rounded border"
            size="2"
          >
            <option
              value="kmeans"
              className="p-2"
            >
              K-means
            </option>
            <option
              value="dbscan"
              className="p-2"
            >
              DBSCAN
            </option>
          </select>
        </div>
        <div className="w-1/2 pl-2">
          <label className="mb-1 block text-sm font-bold">Max Points:</label>
          <NumberInput
            value={maxPoints}
            onChange={setMaxPoints}
            min={2}
          />
        </div>
      </div>
      {algorithm === 'dbscan' && (
        <button
          onClick={() => setClusterUnclustered(!clusterUnclustered)}
          className="mt-4 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
        >
          {clusterUnclustered ? 'Uncluster Noise' : 'Cluster Noise'}
        </button>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4">
        <div>
          <label className="mb-1 block text-sm font-bold">Start Date:</label>
          <input
            ref={startDateRef}
            type="datetime-local"
            value={toLocalDateTimeString(startDate)}
            onChange={e => handleDateChange(e, setStartDate)}
            className="w-full cursor-pointer rounded border p-2"
            step="900" // 15 minutes in seconds
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold">End Date:</label>
          <input
            ref={endDateRef}
            type="datetime-local"
            value={toLocalDateTimeString(endDate)}
            onChange={e => handleDateChange(e, setEndDate)}
            className="w-full cursor-pointer rounded border p-2"
            step="900" // 15 minutes in seconds
          />
        </div>
      </div>
    </div>
  )
}

export default MapTools
