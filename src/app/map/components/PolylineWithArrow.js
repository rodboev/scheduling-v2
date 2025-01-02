'use client'

import L from 'leaflet'
import 'leaflet-polylinedecorator'
import { useEffect, useRef } from 'react'
import { Polyline, useMap } from 'react-leaflet'

function PolylineWithArrow({ positions, color }) {
  const polylineRef = useRef(null)
  const map = useMap()

  useEffect(() => {
    if (!polylineRef.current) return

    const decorator = L.polylineDecorator(polylineRef.current, {
      patterns: [
        {
          offset: '100%',
          repeat: 0,
          symbol: L.Symbol.arrowHead({
            pixelSize: 7,
            polygon: false,
            pathOptions: {
              stroke: true,
              color,
              weight: 2,
            },
          }),
        },
        // Add a second pattern for arrows along the line
        {
          offset: 50,
          repeat: 100,
          symbol: L.Symbol.arrowHead({
            pixelSize: 7,
            polygon: false,
            pathOptions: {
              stroke: true,
              color,
              weight: 2,
            },
          }),
        },
      ],
    }).addTo(map)

    return () => {
      map.removeLayer(decorator)
    }
  }, [map, positions, color])

  return (
    <Polyline
      ref={polylineRef}
      positions={positions}
      pathOptions={{
        color,
        weight: 2,
        opacity: 0.8,
      }}
    />
  )
}

export default PolylineWithArrow
