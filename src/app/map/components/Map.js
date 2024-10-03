'use client'

import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer } from 'react-leaflet'
import MapMarker from './MapMarker'
import MapPopup from './MapPopup'
import MapTools from './MapTools'

const Map = () => {
  const [clusteredServices, setClusteredServices] = useState([])
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
  const [minPoints, setMinPoints] = useState(6)
  const [maxPoints, setMaxPoints] = useState(12)
  const [activePopup, setActivePopup] = useState(null)
  const center = [40.7676, -73.956] // New York City coordinates as default center
  const markerRefs = useRef({})
  const updateServiceEnforcement = (serviceId, checked) => {
    // Implement the logic to update service enforcement
    console.log(`Updating service ${serviceId} enforcement to ${checked}`)
    // You might want to update the state or make an API call here
  }

  useEffect(() => {
    const fetchClusteredServices = async () => {
      try {
        const response = await axios.get('/api/cluster', {
          params: {
            start: '2024-09-01T04:00:00.000Z',
            end: '2024-09-08T03:59:59.999Z',
            clusterUnclustered,
            minPoints,
            maxPoints,
          },
        })
        setClusteredServices(response.data)
      } catch (error) {
        console.error('Error fetching clustered services:', error)
        setClusteredServices([])
      }
    }
    fetchClusteredServices()
  }, [clusterUnclustered, minPoints, maxPoints])

  const handleMapClick = () => {
    if (activePopup) {
      markerRefs.current[activePopup].closePopup()
      setActivePopup(null)
    }
  }

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        clusterUnclustered={clusterUnclustered}
        setClusterUnclustered={setClusterUnclustered}
        minPoints={minPoints}
        setMinPoints={setMinPoints}
        maxPoints={maxPoints}
        setMaxPoints={setMaxPoints}
      />
      <MapContainer
        center={center}
        zoom={13}
        className="h-full w-full"
        onClick={handleMapClick}
        tap={false}
      >
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
