'use client'

import { Skeleton } from '@/app/components/ui/skeleton'
import dynamic from 'next/dynamic'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

const MapView = dynamic(() => import('./components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="space-y-4">
        <Skeleton className="h-[600px] w-[800px] rounded-lg" />
        <div className="text-center text-muted-foreground">Loading map...</div>
      </div>
    </div>
  ),
})

const MapPage = () => {
  return (
    <div className={`h-screen w-screen ${inter.className}`}>
      <MapView />
    </div>
  )
}

export default MapPage
