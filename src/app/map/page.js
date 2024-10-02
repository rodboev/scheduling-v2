'use client'

import { useState, useEffect } from 'react'
import axios from 'axios'
import dynamic from 'next/dynamic'

// Dynamically import the Map component with ssr disabled
const Map = dynamic(() => import('./Map'), {
  ssr: false,
  loading: () => <p>Loading map...</p>,
})

const MapPage = () => {
  const [services, setServices] = useState([])

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await axios.get('/api/services', {
          params: {
            start: '2024-09-01T04:00:00.000Z',
            end: '2024-09-08T03:59:59.999Z',
          },
        })
        setServices(response.data)
      } catch (error) {
        console.error('Error fetching services:', error)
      }
    }

    fetchServices()
  }, [])

  if (!services.length) return <div>Loading...</div>

  return <Map services={services} />
}

export default MapPage
