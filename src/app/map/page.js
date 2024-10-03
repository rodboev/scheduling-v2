'use client'

import dynamic from 'next/dynamic'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

// Dynamically import the Map component with ssr disabled
const Map = dynamic(() => import('./components/Map'), {
  ssr: false,
  loading: () => <p className="mt-8 text-center text-xl">Loading map...</p>,
})

const MapPage = () => {
  return (
    <div className={`h-screen w-screen ${inter.className}`}>
      <Map />
    </div>
  )
}

export default MapPage
