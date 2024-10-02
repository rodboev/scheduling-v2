'use client'

import dynamic from 'next/dynamic'

// Dynamically import the Map component with ssr disabled
const Map = dynamic(() => import('./Map'), {
  ssr: false,
  loading: () => <p>Loading map...</p>,
})

const MapPage = () => {
  return <Map />
}

export default MapPage
