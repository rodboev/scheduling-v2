'use client'

import NumberInput from './NumberInput'

const MapTools = ({
  clusterUnclustered,
  setClusterUnclustered,
  minPoints,
  setMinPoints,
  maxPoints,
  setMaxPoints,
}) => {
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
    </div>
  )
}

export default MapTools
