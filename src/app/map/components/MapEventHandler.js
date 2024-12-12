'use client'

import { useEffect } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'

/**
 * MapEventHandler Component
 * Handles map interaction events
 * - Closes active popups on map click
 * - Logs map center coordinates on movement
 */
export default function MapEventHandler({ setActivePopup }) {
  const map = useMap()

  useMapEvents({
    click() {
      setActivePopup(null)
    },
  })

  useEffect(() => {
    if (!map) return

    const handleMoveEnd = () => {
      const center = map.getCenter()
      // console.log('Current center:', center.lat.toFixed(3), center.lng.toFixed(3))
    }

    map.on('moveend', handleMoveEnd)

    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [map])

  return null
}
