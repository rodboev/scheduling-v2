'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import MapMarker from '@/app/map/components/MapMarker'
import Service from '@/app/components/Service'
import MapTools from '@/app/map/components/MapTools'
import { chunk } from '@/app/map/utils/array'
import { getDistance } from '@/app/map/utils/distance'
import { logMapActivity } from '@/app/map/utils/logging'
import { SHIFT_DURATION_MS, DEFAULT_DATE } from '@/app/utils/constants'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polygon, Polyline } from 'react-leaflet'
import MapEventHandler from '@/app/map/components/MapEventHandler'
import { BOROUGH_BOUNDARIES } from '@/app/utils/boroughs'
import { COLORS } from '@/app/map/utils/colors'
import 'leaflet-polylinedecorator'
import PolylineWithArrow from './PolylineWithArrow'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import MapService from '@/app/map/components/MapService'

// Add debug logging for import
console.log('logMapActivity imported:', typeof logMapActivity)

/**
 * MapView Component
 * Handles the main map display, clustering, and scheduling logic
 * - Displays services as markers on the map
 * - Groups services into clusters based on location and time
 * - Schedules services within clusters based on time/distance priority
 */

const MapView = () => {
  const [clusteredServices, setClusteredServices] = useState([])
  const [clusteringInfo, setClusteringInfo] = useState(null)
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
  const [minPoints, setMinPoints] = useState(8) // Default min points
  const [maxPoints, setMaxPoints] = useState(14) // Default max points
  const [isLoading, setIsLoading] = useState(true) // Add isLoading state

  const clearServices = useCallback(() => {
    setClusteredServices([])
    setClusteringInfo(null)
  }, [])

  // UI state
  const [activePopup, setActivePopup] = useState(null)
  const [date, setDate] = useState(() => {
    return dayjs.tz(DEFAULT_DATE, 'America/New_York').startOf('day').toISOString()
  })
  const center = [40.72, -73.97] // BK: [40.687, -73.965]
  const markerRefs = useRef({})
  const [algorithm, setAlgorithm] = useState('kmeans')

  const updateServiceEnforcement = useCallback((serviceId, checked) => {
    console.log(`Updating service ${serviceId} enforcement to ${checked}`)
    // Implement the logic to update service enforcement
  }, [])

  const addDistanceInfo = useCallback(async services => {
    const servicesWithDistance = [...services]

    // Group services by cluster
    const clusters = servicesWithDistance.reduce((acc, service) => {
      if (service.cluster >= 0) {
        if (!acc[service.cluster]) acc[service.cluster] = []
        acc[service.cluster].push(service)
      }
      return acc
    }, {})

    // Get all unique location IDs
    const locationIds = [
      ...new Set(servicesWithDistance.map(s => s.location?.id?.toString()).filter(Boolean)),
    ]

    // If no locations need distance calculation, return early
    if (locationIds.length <= 1) {
      return servicesWithDistance
    }

    // Get the full distance matrix at once
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    const matrixResponse = await fetch(
      `${baseUrl}/api/distance-matrix?ids=${Array.from(locationIds).join(',')}&format=array`,
    )
    const distanceMatrix = await matrixResponse.json()

    // Function to get distance between two services using the matrix
    function getDistance(service1, service2) {
      // Find indices in locationIds array
      const idx1 = locationIds.indexOf(service1.location.id.toString())
      const idx2 = locationIds.indexOf(service2.location.id.toString())
      if (idx1 === -1 || idx2 === -1) return Infinity
      return distanceMatrix[idx1][idx2] || Infinity
    }

    // Now process each cluster with the distance matrix
    for (const clusterServices of Object.values(clusters)) {
      const sortedCluster = clusterServices.sort(
        (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
      )

      // Add sequence numbers and distances to services
      for (let i = 0; i < sortedCluster.length; i++) {
        const currentService = sortedCluster[i]
        currentService.sequenceNumber = i + 1 // Always set sequence number for every service

        if (i > 0) {
          // Only set distance/previous info for non-first services
          const previousService = sortedCluster[i - 1]
          const idx1 = locationIds.indexOf(previousService.location.id.toString())
          const idx2 = locationIds.indexOf(currentService.location.id.toString())
          const distance = idx1 !== -1 && idx2 !== -1 ? distanceMatrix[idx1][idx2] : null

          if (distance) {
            currentService.distanceFromPrevious = distance
            currentService.previousCompany = previousService.company
          }
        }
      }
    }

    return servicesWithDistance
  }, [])

  const fetchClusteredServices = useCallback(
    async (targetDate = date) => {
      try {
        setIsLoading(true)
        // Clear existing services first
        setClusteredServices([])
        setClusteringInfo(null)

        // Force refresh the location and distance data
        await fetch('/api/distance/refresh')

        // Set start date to midnight Eastern and end date to midnight Eastern the next day
        const startDate = dayjs.tz(targetDate, 'America/New_York').startOf('day')
        const endDate = dayjs.tz(targetDate, 'America/New_York').add(1, 'day').startOf('day')

        if (!startDate.isValid() || !endDate.isValid()) {
          console.error('Invalid date range')
          setIsLoading(false)
          return
        }

        const response = await axios.get('/api/schedule', {
          params: {
            start: startDate.toISOString(),
            end: endDate.toISOString(),
          },
        })

        const data = response.data

        if (!data.scheduledServices) {
          console.error('Invalid response format:', data)
          setIsLoading(false)
          return
        }

        if (data.scheduledServices.length === 0) {
          console.log('No services found for the specified date range')
          setIsLoading(false)
          return
        }

        // Add distance information to services
        const servicesWithDistance = await addDistanceInfo(data.scheduledServices)

        // Update state with the processed services
        setClusteredServices(servicesWithDistance)
        setClusteringInfo(data.clusteringInfo)

        // Add logging
        console.log('Services loaded:', {
          total: servicesWithDistance.length,
          clusters: new Set(servicesWithDistance.map(s => s.cluster).filter(c => c >= 0)).size,
          connected: servicesWithDistance.filter(s => s.cluster >= 0).length,
          outliers: servicesWithDistance.filter(s => s.cluster === -1).length,
        })

        try {
          logMapActivity({
            services: servicesWithDistance,
            clusteringInfo: data.clusteringInfo,
          })
        } catch (error) {
          console.error('Error in logMapActivity:', error)
        }
      } catch (error) {
        console.error('Error fetching services:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [date, addDistanceInfo],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    const defaultDate = dayjs.tz(DEFAULT_DATE, 'America/New_York').startOf('day').toISOString()
    fetchClusteredServices(defaultDate)
  }, [])

  const handleMapClick = useCallback(() => {
    if (activePopup) {
      markerRefs.current[activePopup]?.closePopup()
      setActivePopup(null)
    }
  }, [activePopup])

  // Update the handleNextDay function to properly handle the date
  const handleNextDay = useCallback(async () => {
    const nextDate = dayjs(date).tz('America/New_York').add(1, 'day').startOf('day')
    await setDate(nextDate.toISOString())
    return nextDate.toISOString()
  }, [date])

  function handlePointsChangeComplete() {
    fetchClusteredServices()
  }

  // Add this near the top with other state declarations
  const [isClient, setIsClient] = useState(false)

  // Add this useEffect near other useEffects
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Convert borough boundaries to array of LatLng arrays for Polygon
  const boroughPolygons = Object.entries(BOROUGH_BOUNDARIES).map(([name, boundary]) => {
    const coords = boundary.geometry.coordinates[0]
    // Convert [lng, lat] to [lat, lng] for Leaflet and ensure valid array
    return {
      name,
      coords: coords?.map(coord => [coord[1], coord[0]]) || [],
    }
  })

  const polygonStyles = {
    manhattan: { color: '#ff4444', weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: '10, 10' },
    brooklyn: { color: '#44ff44', weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: '10, 10' },
    queens: { color: '#4444ff', weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: '10, 10' },
    bronx: { color: '#ffff44', weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: '10, 10' },
    nj: { color: '#ff44ff', weight: 2, opacity: 0.6, fillOpacity: 0, dashArray: '10, 10' },
  }

  // Add this function to organize services by cluster
  const clusterPolylines = useMemo(() => {
    if (!clusteredServices?.length) return []

    // Group services by cluster and sort by sequence number
    const clusters = clusteredServices.reduce((acc, service) => {
      if (service.cluster >= 0) {
        if (!acc[service.cluster]) acc[service.cluster] = []
        acc[service.cluster].push(service)
      }
      return acc
    }, {})

    // Create polylines for each cluster
    return Object.entries(clusters).map(([clusterId, services]) => {
      // Sort services by sequence number
      const sortedServices = [...services].sort((a, b) => a.sequenceNumber - b.sequenceNumber)

      // Create array of coordinates
      const coordinates = sortedServices.map(service => [
        service.location.latitude,
        service.location.longitude,
      ])

      // Get color based on cluster ID (matching marker colors)
      const colorKeys = Object.keys(COLORS)
      const color = COLORS[colorKeys[Number(clusterId) % colorKeys.length]]

      return {
        clusterId,
        coordinates,
        color,
      }
    })
  }, [clusteredServices])

  // Function to get distances for a set of services
  async function getDistanceMatrix(services) {
    if (!services?.length) return {}

    // Only get distances for services in the same cluster
    const locationIds = [...new Set(services.map(s => s.location?.id?.toString()).filter(Boolean))]

    // If we have too many locations, split into smaller requests
    const MAX_LOCATIONS_PER_REQUEST = 20
    const matrices = {}

    for (let i = 0; i < locationIds.length; i += MAX_LOCATIONS_PER_REQUEST) {
      const batchIds = locationIds.slice(i, i + MAX_LOCATIONS_PER_REQUEST)
      const response = await axios.get('/api/distance-matrix', {
        params: { ids: batchIds.join(',') },
      })
      Object.assign(matrices, response.data)
    }

    return matrices
  }

  // Function to update distances for a cluster
  async function updateClusterDistances(cluster) {
    if (!cluster?.length) return cluster

    // Sort services by sequence number or start time first
    const sortedServices = [...cluster].sort((a, b) => {
      if (a.sequenceNumber !== undefined && b.sequenceNumber !== undefined) {
        return a.sequenceNumber - b.sequenceNumber
      }
      return new Date(a.start) - new Date(b.start)
    })

    // Only get distances between consecutive services
    const locationPairs = []
    for (let i = 1; i < sortedServices.length; i++) {
      const prev = sortedServices[i - 1]
      const curr = sortedServices[i]
      locationPairs.push([prev.location.id, curr.location.id])
    }

    // Get distances only for the pairs we need
    const matrix = await getDistanceMatrix(sortedServices)
    let totalDistance = 0
    let totalTravelTime = 0

    // Update distances and travel times
    for (let i = 1; i < sortedServices.length; i++) {
      const prevService = sortedServices[i - 1]
      const currService = sortedServices[i]
      const key = `${prevService.location.id},${currService.location.id}`
      const distance = matrix[key] || 0

      currService.distanceFromPrevious = distance
      currService.travelTimeFromPrevious = Math.ceil((distance / TECH_SPEED_MPH) * 60)
      currService.previousCompany = prevService.company

      totalDistance += distance
      totalTravelTime += currService.travelTimeFromPrevious
    }

    return {
      services: sortedServices,
      totalDistance,
      totalTravelTime,
    }
  }

  // Function to process services and update distances
  async function processServices(services) {
    if (!services?.length) return []

    // Group services by cluster
    const clusters = {}
    for (const service of services) {
      const cluster = service.cluster ?? -1
      if (!clusters[cluster]) clusters[cluster] = []
      clusters[cluster].push(service)
    }

    // Process each cluster in parallel
    const processedClusters = await Promise.all(
      Object.entries(clusters).map(async ([clusterId, clusterServices]) => {
        const result = await updateClusterDistances(clusterServices)
        return { clusterId, ...result }
      }),
    )

    // Combine all processed services
    return processedClusters.flatMap(cluster => cluster.services)
  }

  const optimizeSchedule = useCallback(
    async (services, distanceBias) => {
      try {
        const distanceMatrix = await createDistanceMatrix(services)
        if (!distanceMatrix) {
          console.error('Failed to create distance matrix')
          return
        }

        // Schedule services using the distance matrix
        const optimizedServices = await scheduleServices(
          services,
          clusterUnclustered,
          distanceBias,
          minPoints,
          maxPoints,
          distanceMatrix,
        )

        setClusteredServices(optimizedServices)
      } catch (error) {
        console.error('Error optimizing schedule:', error)
      }
    },
    [clusterUnclustered, minPoints, maxPoints],
  )

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        date={date}
        setDate={setDate}
        handleNextDay={handleNextDay}
        fetchClusteredServices={fetchClusteredServices}
        isLoading={isLoading}
        clearServices={clearServices}
      />
      {!isClient ? (
        <div className="h-full w-full bg-gray-100" /> // Loading placeholder
      ) : (
        <MapContainer
          center={center}
          zoom={13}
          className="h-full w-full"
          onClick={handleMapClick}
          tap={false}
          attributionControl={false}
        >
          <MapEventHandler setActivePopup={setActivePopup} />
          <TileLayer
            url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`}
            attribution=""
          />

          {/* Add borough boundary polygons */}
          {/* {boroughPolygons.map(
              ({ name, coords }) =>
                coords.length > 0 && (
                  <Polygon
                    key={`borough-${name}`}
                    positions={coords}
                    pathOptions={polygonStyles[name]}
                  />
                ),
            )} */}

          {/* Add Polylines */}
          {!isLoading &&
            clusterPolylines.map(({ clusterId, coordinates, color }) => (
              <PolylineWithArrow
                key={`polyline-${clusterId}`}
                positions={coordinates}
                color={color}
              />
            ))}

          {!isLoading &&
            clusteredServices.reduce(
              (acc, service, i) => {
                const index = service.cluster >= 0 ? acc.validMarkers + 1 : undefined
                acc.markers.push(
                  <MapMarker
                    key={service.id}
                    service={service}
                    markerRefs={markerRefs}
                    activePopup={activePopup}
                    setActivePopup={setActivePopup}
                    index={index}
                  >
                    <MapService service={service} />
                  </MapMarker>,
                )
                if (service.cluster >= 0) {
                  acc.validMarkers += 1
                }
                return acc
              },
              { markers: [], validMarkers: 0 },
            ).markers}
        </MapContainer>
      )}
      {clusteringInfo && (
        <div className="absolute bottom-4 right-4 z-[1000] rounded bg-white px-4 py-3 shadow">
          <p>Runtime: {clusteringInfo.performanceDuration} ms</p>
          <p>Connected Points: {clusteringInfo.connectedPointsCount}</p>
          <p>Clusters: {clusteringInfo.totalClusters}</p>
          <p>Singles: {clusteringInfo.clusterSizes?.filter(size => size === 1).length || 0}</p>
          <p>
            Techs: {Object.keys(clusteringInfo.techAssignments || {}).length} (from{' '}
            {new Set(clusteredServices.map(s => s.tech?.code).filter(Boolean)).size})
          </p>
        </div>
      )}
    </div>
  )
}

export default MapView
