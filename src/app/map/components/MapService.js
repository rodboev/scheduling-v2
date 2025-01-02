'use client'

import dynamic from 'next/dynamic'
import ServiceContent from '@/app/components/ServiceContent'

const LeafletPopup = dynamic(
  async () => {
    const { Popup } = await import('react-leaflet')
    return Popup
  },
  { ssr: false },
)

export default function MapService({ service }) {
  return (
    <LeafletPopup>
      <ServiceContent service={service} />
    </LeafletPopup>
  )
}
