'use client'

import { useState, useRef, useMemo } from 'react'
import 'leaflet-defaulticon-compatibility'
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'

const Map = ({ services }) => {
  const center = [40.7128, -74.006] // New York City coordinates as default center
  const [activeMarker, setActiveMarker] = useState(null)
  const markerRefs = useRef({})

  const eventHandlers = useMemo(
    () => ({
      mouseover(event) {
        const markerId = event.target.options.id
        setActiveMarker(markerId)
        markerRefs.current[markerId].openPopup()
      },
      mouseout(event) {
        const markerId = event.target.options.id
        setActiveMarker(null)
        markerRefs.current[markerId].closePopup()
      },
    }),
    [],
  )

  return (
    <MapContainer
      center={center}
      zoom={10}
      style={{ height: '100vh', width: '100vw' }}
    >
      <TileLayer
        url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`}
        attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a> contributors'
      />
      {services.map(service => (
        <Marker
          key={service.id}
          id={service.id}
          position={[service.location.latitude, service.location.longitude]}
          eventHandlers={eventHandlers}
          ref={element => {
            if (element) {
              markerRefs.current[service.id] = element
            }
          }}
        >
          <Popup>
            <h3>{service.company}</h3>
            <p>{service.location.address}</p>
            <p>{service.location.address2}</p>
            <p>Tech: {service.tech.name}</p>
            <p>Date: {new Date(service.date).toLocaleDateString()}</p>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

export default Map
