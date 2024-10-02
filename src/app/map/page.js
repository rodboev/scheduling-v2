'use client'

import dynamic from 'next/dynamic'

// Dynamically import the Map component with ssr disabled
const Map = dynamic(() => import('./Map'), {
  ssr: false,
  loading: () => <p className="mt-8 text-center text-xl">Loading map...</p>,
})

const MapPage = () => {
  return (
    <div className="h-screen w-screen">
      <Map />
    </div>
  )
}

export default MapPage
