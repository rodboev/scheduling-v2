'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { scheduleServices } from '@/app/api/cluster/scheduling'
import MapMarker from '@/app/map/components/MapMarker'
import MapPopup from '@/app/map/components/MapPopup'
import MapTools from '@/app/map/components/MapTools'
import { chunk } from '@/app/map/utils/array'
import { getDistance } from '@/app/map/utils/distance'
import { logSchedule } from '@/app/map/utils/scheduleLogger'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'

/**
 * MapView Component
 * Handles the main map display, clustering, and scheduling logic
 * - Displays services as markers on the map
 * - Groups services into clusters based on location and time
 * - Schedules services within clusters based on time/distance priority
 */

/**
 * MapEventHandler Component
 * Handles map interaction events
 * - Closes active popups on map click
 * - Logs map center coordinates on movement
 */
function MapEventHandler({ setActivePopup }) {
  const map = useMap()

  useMapEvents({
    click() {
      setActivePopup(null)
    },
  })

  useEffect(() => {
    if (!map) return

    const handleMoveEnd = () => {
      const center = map.getCenter()
      console.log(
        'Current center:',
        center.lat.toFixed(3),
        center.lng.toFixed(3),
      )
    }

    map.on('moveend', handleMoveEnd)

    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [map])

  return null
}

const MapView = () => {
  const [clusteredServices, setClusteredServices] = useState([])
  const [clusteringInfo, setClusteringInfo] = useState(null)
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
  const [minPoints, setMinPoints] = useState(8) // Default min points
  const [maxPoints, setMaxPoints] = useState(14) // Default max points
  const [isLoading, setIsLoading] = useState(true) // Add isLoading state

  // UI state
  const [activePopup, setActivePopup] = useState(null)
  const [startDate, setStartDate] = useState('2024-09-03T02:30:00.000Z')
  const [endDate, setEndDate] = useState('2024-09-03T12:30:00.000Z')
  const center = [40.72, -73.97] // BK: [40.687, -73.965]
  const markerRefs = useRef({})
  const [algorithm, setAlgorithm] = useState('kmeans')
  const [distanceBias, setDistanceBias] = useState(50)
  const [isRescheduling, setIsRescheduling] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)

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
        allPairs.push(
          `${sortedCluster[i - 1].location.id},${sortedCluster[i].location.id}`,
        )
      }
    }

    // Split ALL pairs into chunks of 1000
    const chunkedPairs = chunk(allPairs, 1000)

    // Fetch distances for all pairs in one go
    const distanceResults = []
    for (const [index, pairChunk] of chunkedPairs.entries()) {
      console.log(
        `Fetching distances batch ${index + 1}/${chunkedPairs.length}`,
      )
      const response = await axios.get('/api/distance', {
        params: {
          id: pairChunk,
        },
        paramsSerializer: params => {
          return params.id.map(pair => `id=${pair}`).join('&')
        },
      })
      distanceResults.push(...response.data)
    }

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
              result.from.id ===
              `${previousService.location.id},${currentService.location.id}`,
          )

          if (pairResult?.distance?.[0]?.distance) {
            currentService.distanceFromPrevious =
              pairResult.distance[0].distance
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

      const response = await axios.get('/api/cluster', {
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

      const servicesWithDistance = await addDistanceInfo(
        response.data.clusteredServices,
      )
      setClusteredServices(servicesWithDistance)
      setClusteringInfo(response.data.clusteringInfo)
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
  }, [
    startDate,
    endDate,
    clusterUnclustered,
    minPoints,
    maxPoints,
    algorithm,
    addDistanceInfo,
  ])

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
      setIsOptimizing(true)
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
            const fromIndex = services.findIndex(
              s => s.location.id.toString() === fromId,
            )
            const toIndex = services.findIndex(
              s => s.location.id.toString() === toId,
            )

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
      } finally {
        setIsOptimizing(false)
      }
    },
    [clusterUnclustered, minPoints, maxPoints],
  )

  // Update the optimization change handler
  const handleOptimizationChange = useCallback(
    async newBias => {
      await optimizeSchedule(clusteredServices, newBias)
    },
    [clusteredServices, optimizeSchedule],
  )

  // Add these refs at the component level, not inside useEffect
  const previousStart = useRef(startDate)
  const previousEnd = useRef(endDate)

  // Update the useEffect
  useEffect(() => {
    if (startDate && endDate && 
        (previousStart.current !== startDate || previousEnd.current !== endDate)) {
      console.log('Fetching services for date range:', { startDate, endDate })
      fetchClusteredServices()
      
      previousStart.current = startDate
      previousEnd.current = endDate
    }
  }, [startDate, endDate, fetchClusteredServices])

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        algorithm={algorithm}
        setAlgorithm={setAlgorithm}
        minPoints={minPoints}
        setMinPoints={setMinPoints}
        maxPoints={maxPoints}
        setMaxPoints={setMaxPoints}
        onPointsChangeComplete={handlePointsChangeComplete}
        clusterUnclustered={clusterUnclustered}
        setClusterUnclustered={setClusterUnclustered}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        handleNextDay={handleNextDay}
        distanceBias={distanceBias}
        setDistanceBias={setDistanceBias}
        isOptimizing={isOptimizing}
        onOptimizationChange={handleOptimizationChange}
      />
      <MapContainer
        center={center}
        zoom={13}
        className="h-full w-full"
        onClick={handleMapClick}
        tap={false}
        attributionControl={false} // Remove attribution control
      >
        <MapEventHandler setActivePopup={setActivePopup} />
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`}
          attribution="" // Remove attribution
        />
        {!isLoading &&
          clusteredServices.reduce(
            (acc, service, i) => {
              const index =
                service.cluster >= 0 ? acc.validMarkers + 1 : undefined
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
          ).markers
        }
      </MapContainer>
      {clusteringInfo && (
        <div className="absolute bottom-4 right-4 z-[1000] rounded bg-white px-4 py-3 shadow">
          <p>Runtime: {clusteringInfo.performanceDuration} ms</p>
          <p>Connected Points: {clusteringInfo.connectedPointsCount}</p>
          <p>Clusters: {clusteringInfo.totalClusters}</p>
          <p>Outliers: {clusteringInfo.outlierCount}</p>
          {clusteringInfo.algorithm === 'dbscan' && (
            <p>Noise: {clusteringInfo.noisePoints}</p>
          )}
        </div>
      )}
    </div>
  )
}

export default MapView
