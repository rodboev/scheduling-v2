'use client'

import { useState, useRef, useMemo, useEffect } from 'react'
import axios from 'axios'
import L from 'leaflet'
import 'leaflet-defaulticon-compatibility'
import 'leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css'
import 'leaflet.awesome-markers'
import 'leaflet.awesome-markers/dist/leaflet.awesome-markers.css'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'

const COLORS = [
  'red',
  'darkred',
  'orange',
  'green',
  'darkgreen',
  'blue',
  'purple',
  'darkpurple',
  'cadetblue',
  'lightred',
  'beige',
  'lightgreen',
  'lightblue',
  'pink',
  'white',
  'lightgray',
  'gray',
  'black',
]

const Map = () => {
  const [clusteredServices, setClusteredServices] = useState([])
  const center = [40.7128, -74.006] // New York City coordinates as default center
  const [activeMarker, setActiveMarker] = useState(null)
  const markerRefs = useRef({})

  useEffect(() => {
    const fetchClusteredServices = async () => {
      try {
        const response = await axios.get('/api/cluster', {
          params: {
            start: '2024-09-01T04:00:00.000Z',
            end: '2024-09-08T03:59:59.999Z',
          },
        })
        setClusteredServices(response.data)
      } catch (error) {
        console.error('Error fetching clustered services:', error)
        setClusteredServices([])
      }
    }
    fetchClusteredServices()
  }, [])

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

  const getMarkerIcon = cluster => {
    const color = cluster === -1 ? 'gray' : COLORS[cluster % COLORS.length]
    return L.AwesomeMarkers.icon({
      icon: 'info-sign',
      markerColor: color,
      prefix: 'fa',
      iconColor: 'white',
    })
  }

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
      {clusteredServices.map(service => (
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
          icon={getMarkerIcon(service.cluster)}
        >
          <Popup>
            <h3>{service.company}</h3>
            <p>{service.location.address}</p>
            <p>{service.location.address2}</p>
            <p>Tech: {service.tech.name}</p>
            <p>Date: {new Date(service.date).toLocaleDateString()}</p>
            <p>
              Cluster:{' '}
              {service.cluster === -1 ? 'Unclustered' : service.cluster}
            </p>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}

export default Map
