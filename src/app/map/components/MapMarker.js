'use client'

import { useMemo, useEffect, useRef } from 'react'
import {
  faCircleExclamation,
  faMapMarker,
} from '@fortawesome/free-solid-svg-icons'
import L from 'leaflet'
import { Marker, useMap } from 'react-leaflet'

const COLORS = {
  red: '#d63e2a',
  darkred: '#a23336',
  orange: '#f69730',
  green: '#72b026',
  darkgreen: '#728224',
  blue: '#38aadd',
  purple: '#9c2bcb',
  darkpurple: '#5b396b',
  cadetblue: '#436978',
  lightred: '#eb7f7f',
  beige: '#ead7c6',
  lightgreen: '#a4c65f',
  lightblue: '#6fbbd3',
  pink: '#df8dc3',
  white: '#ffffff',
  lightgray: '#d3d3d3',
  gray: '#808080',
  darkgray: '#404040',
  yellow: '#ffff00',
  black: '#000000',
}

// Function to calculate contrast ratio
function getContrastRatio(color) {
  const rgb = parseInt(color.slice(1), 16)
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = (rgb >> 0) & 0xff
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

const MapMarker = ({
  service,
  markerRefs,
  activePopup,
  setActivePopup,
  children,
  index, // Renamed from sequenceNumber
}) => {
  const map = useMap()
  const popupRef = useRef(null)
  const markerRef = useRef(null)
  const timeoutRef = useRef(null)

  const getMarkerIcon = cluster => {
    const colorKeys = Object.keys(COLORS)
    const color =
      cluster < 0
        ? COLORS.darkgray
        : COLORS[colorKeys[cluster % colorKeys.length]]
    const icon = cluster < 0 ? faCircleExclamation : faMapMarker

    // Calculate a darker stroke color (25% darker)
    const strokeColor = darkenColor(color, 0.25)

    // Increase the viewBox size to accommodate the stroke
    const viewBoxWidth = icon.icon[0] + 32
    const viewBoxHeight = icon.icon[1] + 32

    // Determine text color based on contrast
    const textColor = getContrastRatio(color)

    return new L.DivIcon({
      html: `
        <svg
          aria-hidden="true"
          focusable="false"
          data-prefix="fas"
          data-icon="${icon.iconName}"
          class="svg-inline--fa fa-${icon.iconName}"
          role="img"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}"
          width="36"
          height="36"
        >
          <path
            fill="${color}"
            stroke="${strokeColor}"
            stroke-width="16"
            d="${icon.icon[4]}"
            transform="translate(16, 16)"
          />
          ${
            index !== undefined
              ? `
            <text
              x="50%"
              y="${viewBoxHeight / 2.75}"
              font-size="${viewBoxWidth / 1.75}"
              fill="${textColor}"
              text-anchor="middle"
              dominant-baseline="central"
            >${index}</text>
          `
              : ''
          }
        </svg>
      `,
      className: 'custom-div-icon',
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    })
  }

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    const markerId = service.id
    markerRefs.current[markerId].openPopup()
    setActivePopup(markerId)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      const markerId = service.id
      if (
        !popupRef.current?.contains(document.activeElement) &&
        !popupRef.current?.matches(':hover')
      ) {
        markerRefs.current[markerId].closePopup()
        setActivePopup(null)
      }
    }, 50)
  }

  const eventHandlers = useMemo(
    () => ({
      mouseover: handleMouseEnter,
      mouseout: handleMouseLeave,
    }),
    [service.id, markerRefs, setActivePopup],
  )

  useEffect(() => {
    if (markerRef.current) {
      const marker = markerRef.current
      marker.off('click') // Remove Leaflet's default click handler
    }
  }, [])

  useEffect(() => {
    if (markerRef.current) {
      const popup = markerRef.current.getPopup()
      if (popup) {
        popupRef.current = popup._container
        if (popupRef.current) {
          popupRef.current.addEventListener('mouseenter', handleMouseEnter)
          popupRef.current.addEventListener('mouseleave', handleMouseLeave)
        }
      }
    }

    return () => {
      if (popupRef.current) {
        popupRef.current.removeEventListener('mouseenter', handleMouseEnter)
        popupRef.current.removeEventListener('mouseleave', handleMouseLeave)
      }
    }
  }, [children, service.id, markerRefs, setActivePopup])

  return (
    <Marker
      id={service.id}
      position={[service.location.latitude, service.location.longitude]}
      eventHandlers={eventHandlers}
      ref={element => {
        if (element) {
          markerRef.current = element
          markerRefs.current[service.id] = element
        }
      }}
      icon={getMarkerIcon(service.cluster, service.wasStatus)}
    >
      {children}
    </Marker>
  )
}

// Helper function to darken a color
function darkenColor(color, factor) {
  const hex = color.replace(/^#/, '')
  const rgb = parseInt(hex, 16)
  const r = Math.floor((rgb >> 16) * (1 - factor))
  const g = Math.floor(((rgb >> 8) & 0x00ff) * (1 - factor))
  const b = Math.floor((rgb & 0x0000ff) * (1 - factor))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export default MapMarker
