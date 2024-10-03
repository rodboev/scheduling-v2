'use client'

import NumberInput from './NumberInput'

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

  return (
    <div className="absolute right-4 top-4 z-[1000] rounded bg-white p-4 shadow">
      <button
        onClick={() => setClusterUnclustered(!clusterUnclustered)}
        className="mb-4 w-full rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
      >
        {clusterUnclustered ? 'Uncluster Noise' : 'Cluster Noise'}
      </button>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="mb-1 block text-sm font-bold">Min Points:</label>
          <NumberInput
            value={minPoints}
            onChange={setMinPoints}
            min={2}
            max={maxPoints - 1}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold">Max Points:</label>
          <NumberInput
            value={maxPoints}
            onChange={setMaxPoints}
            min={minPoints + 1}
          />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4">
        <div>
          <label className="mb-1 block text-sm font-bold">Start Date:</label>
          <input
            type="datetime-local"
            value={toLocalDateTimeString(startDate)}
            onChange={e => handleDateChange(e, setStartDate)}
            className="w-full rounded border p-2"
            step="900" // 15 minutes in seconds
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-bold">End Date:</label>
          <input
            type="datetime-local"
            value={toLocalDateTimeString(endDate)}
            onChange={e => handleDateChange(e, setEndDate)}
            className="w-full rounded border p-2"
            step="900" // 15 minutes in seconds
          />
        </div>
      </div>
    </div>
  )
}

export default MapTools
