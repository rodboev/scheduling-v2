'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { scheduleServices } from '@/app/api/cluster/scheduling'
import MapMarker from '@/app/map/components/MapMarker'
import MapPopup from '@/app/map/components/MapPopup'
import MapTools from '@/app/map/components/MapTools'
import { chunk } from '@/app/map/utils/array'
import { getDistance } from '@/app/map/utils/distance'
import { logSchedule } from '@/app/map/utils/scheduleLogger'
import { SHIFT_DURATION_MS, SHIFTS } from '@/app/utils/constants'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Polygon, Polyline } from 'react-leaflet'
import MapEventHandler from '@/app/map/components/MapEventHandler'
import { logMapActivity } from '@/app/api/cluster-single/logging'
import { BOROUGH_BOUNDARIES } from '@/app/utils/boroughs'
import { COLORS } from '@/app/map/utils/colors'
import 'leaflet-polylinedecorator'
import PolylineWithArrow from './PolylineWithArrow'

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
  const [activeShift, setActiveShift] = useState(1) // Add activeShift state

  const clearServices = useCallback(() => {
    setClusteredServices([])
    setClusteringInfo(null)
  }, [])

  // UI state
  const [activePopup, setActivePopup] = useState(null)
  const [startDate, setStartDate] = useState(() => {
    const date = new Date('2024-09-03T00:00:00.000Z')
    const [hours, minutes] = SHIFTS[1].start.split(':').map(Number)
    date.setUTCHours(hours, minutes, 0, 0)
    return date.toISOString()
  })
  const [endDate, setEndDate] = useState(() => {
    const date = new Date('2024-09-03T00:00:00.000Z')
    const [hours, minutes] = SHIFTS[1].start.split(':').map(Number)
    date.setUTCHours(hours, minutes, 0, 0)
    date.setTime(date.getTime() + SHIFT_DURATION_MS)
    return date.toISOString()
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

    // Collect ALL pairs across ALL clusters first
    const allPairs = []
    for (const clusterServices of Object.values(clusters)) {
      const sortedCluster = clusterServices.sort(
        (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
      )

      // Create pairs for all sequential services in the cluster
      for (let i = 1; i < sortedCluster.length; i++) {
        const fromId = sortedCluster[i - 1].location.id
        const toId = sortedCluster[i].location.id
        if (fromId && toId) {
          allPairs.push(`${fromId},${toId}`)
        }
      }
    }

    // If no pairs need distance calculation, return early
    if (allPairs.length === 0) {
      return servicesWithDistance
    }

    // Split ALL pairs into chunks of 50 for more efficient batching
    const chunkedPairs = chunk(allPairs, 50)

    // Fetch distances for all pairs in parallel
    const distancePromises = chunkedPairs.map(pairChunk =>
      axios.get('/api/distance', {
        params: {
          id: pairChunk,
        },
        paramsSerializer: params => {
          return params.id.map(pair => `id=${pair}`).join('&')
        },
      }),
    )

    const responses = await Promise.all(distancePromises)
    const distanceResults = responses.flatMap(response =>
      response.data.error ? [] : response.data,
    )

    // Now process each cluster with the complete distance results
    for (const clusterServices of Object.values(clusters)) {
      const sortedCluster = clusterServices.sort(
        (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
      )

      // Add sequence numbers and distances to services
      for (let i = 0; i < sortedCluster.length; i++) {
        const currentService = sortedCluster[i]
        currentService.sequenceNumber = i + 1

        if (i > 0) {
          const previousService = sortedCluster[i - 1]
          const pairResult = distanceResults.find(
            result =>
              result.pair?.id === `${previousService.location.id},${currentService.location.id}`,
          )

          if (pairResult?.pair?.distance) {
            currentService.distanceFromPrevious = pairResult.pair.distance
            currentService.previousCompany = previousService.company
          }
        }
      }
    }

    return servicesWithDistance
  }, [])

  const fetchClusteredServices = useCallback(async () => {
    try {
      setIsLoading(true)
      // Validate dates
      const start = new Date(startDate)
      const end = new Date(endDate)

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        console.error('Invalid date range')
        return
      }

      // Add loading state
      setClusteredServices([])
      setClusteringInfo(null)

      const response = await axios.get('/api/cluster-single', {
        params: {
          start: startDate,
          end: endDate,
          clusterUnclustered,
          minPoints,
          maxPoints,
          algorithm,
        },
      })

      if (!response.data?.clusteredServices) {
        console.error('Invalid response format:', response.data)
        return
      }

      if (response.data.clusteredServices.length === 0) {
        console.log('No services found for the specified date range')
        return
      }

      // Filter services by time window
      const filteredServices = response.data.clusteredServices.filter(service => {
        const serviceTimeStart = new Date(service.time.range[0])
        const serviceTimeEnd = new Date(service.time.range[1])
        const scheduledStart = new Date(service.start)
        const scheduledEnd = new Date(service.end)
        const windowStart = new Date(startDate)
        const windowEnd = new Date(endDate)

        // Service must have a valid time window and scheduled times
        if (!serviceTimeStart || !serviceTimeEnd || !scheduledStart || !scheduledEnd) {
          return false
        }

        // Check if the service's time window overlaps with our shift window
        const timeWindowOverlaps = serviceTimeStart <= windowEnd && serviceTimeEnd >= windowStart

        // Check if the service is scheduled within our window
        const isScheduledInWindow = scheduledStart >= windowStart && scheduledEnd <= windowEnd

        // Service must have both overlapping time window AND be scheduled within the window
        return timeWindowOverlaps && isScheduledInWindow
      })

      // Add debug logging
      console.log('Time window:', {
        start: new Date(startDate).toLocaleString(),
        end: new Date(endDate).toLocaleString(),
      })
      console.log('Original services:', response.data.clusteredServices.length)
      console.log('Filtered services:', filteredServices.length)
      console.log('Sample filtered service:', filteredServices[0])

      const servicesWithDistance = await addDistanceInfo(filteredServices)

      // Add debug logging
      console.log('=== Debug Logging ===')
      console.log('Services with distance:', servicesWithDistance.length)
      console.log('Sample service:', servicesWithDistance[0])
      console.log(
        'Clusters:',
        new Set(filteredServices.map(s => s.cluster).filter(c => c >= 0)).size,
      )
      console.log('Connected points:', filteredServices.filter(s => s.cluster >= 0).length)
      console.log('Outliers:', filteredServices.filter(s => s.cluster === -1).length)
      console.log('About to call logMapActivity...')

      // Add logging here - moved after filtering
      try {
        console.log('Services array type:', Array.isArray(servicesWithDistance))
        console.log('ClusteringInfo:', {
          ...response.data.clusteringInfo,
          totalClusters: new Set(filteredServices.map(s => s.cluster).filter(c => c >= 0)).size,
          connectedPointsCount: filteredServices.filter(s => s.cluster >= 0).length,
          outlierCount: filteredServices.filter(s => s.cluster === -1).length,
          performanceDuration: response.data.clusteringInfo.performanceDuration,
        })

        logMapActivity({
          services: servicesWithDistance,
          clusteringInfo: {
            ...response.data.clusteringInfo,
            // Update clustering info to reflect filtered services
            totalClusters: new Set(filteredServices.map(s => s.cluster).filter(c => c >= 0)).size,
            connectedPointsCount: filteredServices.filter(s => s.cluster >= 0).length,
            outlierCount: filteredServices.filter(s => s.cluster === -1).length,
            performanceDuration: response.data.clusteringInfo.performanceDuration,
          },
          algorithm,
        })
        console.log('logMapActivity completed')
      } catch (error) {
        console.error('Error in logMapActivity:', error)
      }

      setClusteredServices(servicesWithDistance)
      setClusteringInfo({
        ...response.data.clusteringInfo,
        // Update clustering info to reflect filtered services
        totalClusters: new Set(filteredServices.map(s => s.cluster).filter(c => c >= 0)).size,
        connectedPointsCount: filteredServices.filter(s => s.cluster >= 0).length,
        outlierCount: filteredServices.filter(s => s.cluster === -1).length,
        performanceDuration: response.data.clusteringInfo.performanceDuration,
      })
    } catch (error) {
      console.error('Error fetching clustered services:', error)
      if (error.response) {
        console.error('Server error:', error.response.data)
      }
      // Reset state on error
      setClusteredServices([])
      setClusteringInfo(null)
    } finally {
      setIsLoading(false)
    }
  }, [startDate, endDate, clusterUnclustered, minPoints, maxPoints, algorithm, addDistanceInfo])

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    fetchClusteredServices(true)
  }, [])

  const handleMapClick = useCallback(() => {
    if (activePopup) {
      markerRefs.current[activePopup]?.closePopup()
      setActivePopup(null)
    }
  }, [activePopup])

  // Update the handleNextDay function to properly handle both start and end dates
  const handleNextDay = useCallback(() => {
    const nextStart = new Date(startDate)
    nextStart.setDate(nextStart.getDate() + 1)

    const nextEnd = new Date(endDate)
    nextEnd.setDate(nextEnd.getDate() + 1)

    setStartDate(nextStart.toISOString())
    setEndDate(nextEnd.toISOString())
  }, [startDate, endDate])

  function handlePointsChangeComplete() {
    fetchClusteredServices()
  }

  const optimizeSchedule = useCallback(
    async (services, distanceBias) => {
      try {
        // Create pairs of service IDs for batch processing
        const pairs = []
        for (let i = 0; i < services.length; i++) {
          for (let j = i + 1; j < services.length; j++) {
            pairs.push(`${services[i].location.id},${services[j].location.id}`)
          }
        }

        // Split pairs into chunks of 500 to avoid too large URLs
        const chunkedPairs = chunk(pairs, 500)
        const distanceMatrix = Array(services.length)
          .fill()
          .map(() => Array(services.length).fill(0))

        // Fetch distances in batches
        for (const pairChunk of chunkedPairs) {
          const response = await axios.get('/api/distance', {
            params: {
              id: pairChunk,
            },
            paramsSerializer: params => {
              return params.id.map(pair => `id=${pair}`).join('&')
            },
          })

          // Populate the distance matrix with results
          for (const result of response.data) {
            const [fromId, toId] = result.from.id.split(',')
            const fromIndex = services.findIndex(s => s.location.id.toString() === fromId)
            const toIndex = services.findIndex(s => s.location.id.toString() === toId)

            if (result.distance?.[0]?.distance) {
              const distance = result.distance[0].distance
              distanceMatrix[fromIndex][toIndex] = distance
              distanceMatrix[toIndex][fromIndex] = distance // Mirror the distance
            }
          }
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

  // Add these refs at the component level, not inside useEffect
  const previousStart = useRef(startDate)
  const previousEnd = useRef(endDate)

  // Update the useEffect
  useEffect(() => {
    if (
      startDate &&
      endDate &&
      (previousStart.current !== startDate || previousEnd.current !== endDate)
    ) {
      console.log('Fetching services for date range:', { startDate, endDate })
      fetchClusteredServices()

      previousStart.current = startDate
      previousEnd.current = endDate
    }
  }, [startDate, endDate, fetchClusteredServices])

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

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        handleNextDay={handleNextDay}
        fetchClusteredServices={fetchClusteredServices}
        isLoading={isLoading}
        activeShift={activeShift}
        setActiveShift={setActiveShift}
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
                    <MapPopup
                      service={service}
                      updateServiceEnforcement={updateServiceEnforcement}
                    />
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
          <p>Outliers: {clusteringInfo.outlierCount}</p>
        </div>
      )}
    </div>
  )
}

export default MapView
