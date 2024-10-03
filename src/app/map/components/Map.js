'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import MapMarker from './MapMarker'
import MapPopup from './MapPopup'
import MapTools from './MapTools'

function MapEventHandler() {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const handleMoveEnd = () => {
      const center = map.getCenter()
      console.log(
        'Current center:',
        center.lat.toFixed(3),
        center.lng.toFixed(3),
      )
    }

    map.on('moveend', handleMoveEnd)

    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [map])

  return null
}

const Map = () => {
  const [clusteredServices, setClusteredServices] = useState([])
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
  const [minPoints, setMinPoints] = useState(4)
  const [maxPoints, setMaxPoints] = useState(12)
  const [activePopup, setActivePopup] = useState(null)
  const [startDate, setStartDate] = useState('2024-09-02T02:30:00.000Z')
  const [endDate, setEndDate] = useState('2024-09-02T10:30:00.000Z')
  const center = [40.687, -73.965] // Fixed the array syntax
  const markerRefs = useRef({})
  const [algorithm, setAlgorithm] = useState('kmeans')

  const updateServiceEnforcement = useCallback((serviceId, checked) => {
    console.log(`Updating service ${serviceId} enforcement to ${checked}`)
    // Implement the logic to update service enforcement
  }, [])

  const fetchClusteredServices = useCallback(async () => {
    try {
      const response = await axios.get('/api/cluster', {
        params: {
          start: startDate,
          end: endDate,
          clusterUnclustered,
          minPoints,
          maxPoints,
          algorithm,
        },
      })
      setClusteredServices(response.data)
    } catch (error) {
      console.error('Error fetching clustered services:', error)
      setClusteredServices([])
    }
  }, [startDate, endDate, clusterUnclustered, minPoints, maxPoints, algorithm])

  useEffect(() => {
    fetchClusteredServices()
  }, [fetchClusteredServices])

  const handleMapClick = useCallback(() => {
    if (activePopup) {
      markerRefs.current[activePopup]?.closePopup()
      setActivePopup(null)
    }
  }, [activePopup])

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        clusterUnclustered={clusterUnclustered}
        setClusterUnclustered={setClusterUnclustered}
        minPoints={minPoints}
        setMinPoints={setMinPoints}
        maxPoints={maxPoints}
        setMaxPoints={setMaxPoints}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        algorithm={algorithm}
        setAlgorithm={setAlgorithm}
      />
      <MapContainer
        center={center}
        zoom={13}
        className="h-full w-full"
        onClick={handleMapClick}
        tap={false}
      >
        <MapEventHandler />
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`}
          attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a> contributors'
        />
        {clusteredServices.map(service => (
          <MapMarker
            key={service.id}
            service={service}
            markerRefs={markerRefs}
            activePopup={activePopup}
            setActivePopup={setActivePopup}
          >
            <MapPopup
              service={service}
              updateServiceEnforcement={updateServiceEnforcement}
            />
          </MapMarker>
        ))}
      </MapContainer>
    </div>
  )
}

export default Map
