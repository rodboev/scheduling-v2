'use client'

import { useEffect, useRef, useMemo } from 'react'
import { faCircleExclamation, faMapMarker } from '@fortawesome/free-solid-svg-icons'
import L from 'leaflet'
import { Marker } from 'react-leaflet'
import { COLORS } from '@/app/map/utils/colors'

function getContrastRatio(color) {
  const rgb = Number.parseInt(color.slice(1), 16)
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = (rgb >> 0) & 0xff
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

const MapMarker = ({ service, markerRefs, setActivePopup, children }) => {
  if (!service) return null

  const popupRef = useRef(null)
  const markerRef = useRef(null)
  const timeoutRef = useRef(null)

  function getMarkerIcon(techId) {
    const colorKeys = Object.keys(COLORS)
    const color = techId
      ? COLORS[colorKeys[(parseInt(techId.replace('Tech ', '')) - 1) % colorKeys.length]]
      : COLORS.darkgray
    const icon = techId ? faMapMarker : faCircleExclamation
    const strokeColor = darkenColor(color, 0.25)
    const viewBoxWidth = icon.icon[0] + 32
    const viewBoxHeight = icon.icon[1] + 32
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
            service.sequenceNumber
              ? `
            <text
              x="50%"
              y="${viewBoxHeight / 2.75}"
              font-size="${viewBoxWidth / 1.75}"
              fill="${textColor}"
              text-anchor="middle"
              dominant-baseline="central"
            >${service.sequenceNumber}</text>
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

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    markerRefs.current[service.id]?.openPopup()
    setActivePopup(service.id)
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => {
      if (
        !popupRef.current?.contains(document.activeElement) &&
        !popupRef.current?.matches(':hover')
      ) {
        markerRefs.current[service.id]?.closePopup()
        setActivePopup(null)
      }
    }, 50)
  }

  useEffect(() => {
    const marker = markerRef.current
    if (marker) {
      marker.off('click')
      const popup = marker.getPopup()
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
  })

  // Memoize the marker icon
  const markerIcon = useMemo(
    () => getMarkerIcon(service.techId),
    [service.techId, service.sequenceNumber],
  )

  return (
    <Marker
      position={[service.location.latitude, service.location.longitude]}
      eventHandlers={{
        mouseover: handleMouseEnter,
        mouseout: handleMouseLeave,
      }}
      ref={element => {
        if (element) {
          markerRef.current = element
          markerRefs.current[service.id] = element
        }
      }}
      icon={markerIcon}
    >
      {children}
    </Marker>
  )
}

function darkenColor(color, factor) {
  if (!color) return '#404040'

  const hex = color.replace(/^#/, '')
  const rgb = Number.parseInt(hex, 16)
  const r = Math.floor((rgb >> 16) * (1 - factor))
  const g = Math.floor(((rgb >> 8) & 0x00ff) * (1 - factor))
  const b = Math.floor((rgb & 0x0000ff) * (1 - factor))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export default MapMarker
