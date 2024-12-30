'use client'

import dynamic from 'next/dynamic'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

// Dynamically import the MapView component with ssr disabled
const MapView = dynamic(() => import('./components/MapView'), {
  ssr: false,
})

const MapPage = () => {
  return (
    <div className={`h-screen w-screen bg-[#f7f8f8] ${inter.className}`}>
      <MapView />
    </div>
  )
}

export default MapPage
