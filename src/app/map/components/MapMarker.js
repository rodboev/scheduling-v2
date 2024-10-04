'use client'

import { useMemo } from 'react'
import L from 'leaflet'
import 'leaflet.awesome-markers'
import 'leaflet.awesome-markers/dist/leaflet.awesome-markers.css'
import { Marker } from 'react-leaflet'

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

const MapMarker = ({
  service,
  markerRefs,
  activePopup,
  setActivePopup,
  children,
}) => {
  const getMarkerIcon = (cluster, wasStatus) => {
    const color = cluster < 0 ? 'gray' : COLORS[cluster % COLORS.length]
    return L.AwesomeMarkers.icon({
      icon: wasStatus ? 'circle-exclamation' : '',
      markerColor: color,
      prefix: 'fa',
      iconColor: 'white',
    })
  }

  const eventHandlers = useMemo(
    () => ({
      mouseover(event) {
        const markerId = event.target.options.id
        if (!activePopup) {
          markerRefs.current[markerId].openPopup()
        }
      },
      mouseout(event) {
        const markerId = event.target.options.id
        if (!activePopup) {
          markerRefs.current[markerId].closePopup()
        }
      },
      click(event) {
        const markerId = event.target.options.id
        if (activePopup === markerId) {
          markerRefs.current[markerId].closePopup()
          setActivePopup(null)
        } else {
          if (activePopup) {
            markerRefs.current[activePopup].closePopup()
          }
          markerRefs.current[markerId].openPopup()
          setActivePopup(markerId)
        }
      },
    }),
    [activePopup, markerRefs, setActivePopup],
  )

  return (
    <Marker
      id={service.id}
      position={[service.location.latitude, service.location.longitude]}
      eventHandlers={eventHandlers}
      ref={element => {
        if (element) {
          markerRefs.current[service.id] = element
        }
      }}
      icon={getMarkerIcon(service.cluster, service.wasStatus)}
    >
      {children}
    </Marker>
  )
}

export default MapMarker
