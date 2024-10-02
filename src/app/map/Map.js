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
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
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
            clusterUnclustered: clusterUnclustered,
          },
        })
        setClusteredServices(response.data)
      } catch (error) {
        console.error('Error fetching clustered services:', error)
        setClusteredServices([])
      }
    }
    fetchClusteredServices()
  }, [clusterUnclustered])

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

  const getMarkerIcon = (cluster, wasNoise) => {
    const color = cluster === -1 ? 'gray' : COLORS[cluster % COLORS.length]
    return L.AwesomeMarkers.icon({
      icon: wasNoise ? 'question-sign' : 'info-sign',
      markerColor: color,
      prefix: 'fa',
      iconColor: 'white',
    })
  }

  return (
    <div className="relative h-screen w-screen">
      <div className="absolute right-4 top-4 z-[1000]">
        <button
          onClick={() => setClusterUnclustered(!clusterUnclustered)}
          className="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
        >
          {clusterUnclustered ? 'Uncluster Noise' : 'Cluster Noise'}
        </button>
      </div>
      <MapContainer
        center={center}
        zoom={10}
        className="h-full w-full"
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
            icon={getMarkerIcon(service.cluster, service.wasNoise)}
          >
            <Popup>
              <div className="text-sm">
                <h3 className="font-bold">{service.company}</h3>
                <div>{service.location.address}</div>
                <div>{new Date(service.date).toLocaleDateString()}</div>
                <div>
                  Cluster:{' '}
                  {service.cluster === -1
                    ? 'Unclustered'
                    : `${service.cluster}${service.wasNoise ? ' (was noise)' : ''}`}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

export default Map
