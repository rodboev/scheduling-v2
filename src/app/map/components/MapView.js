'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { scheduleServices } from '@/app/api/cluster/scheduling'
import MapMarker from '@/app/map/components/MapMarker'
import MapPopup from '@/app/map/components/MapPopup'
import MapTools from '@/app/map/components/MapTools'
import { getDistance } from '@/app/map/utils/distance'
import { logSchedule } from '@/app/map/utils/scheduleLogger'
import axios from 'axios'
import 'leaflet/dist/leaflet.css'
import debounce from 'lodash/debounce'
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
  const [maxPoints, setMaxPoints] = useState(16) // Default max points

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

    // Add sequence numbers and distances within each cluster
    for (const clusterServices of Object.values(clusters)) {
      const sortedCluster = clusterServices.sort(
        (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
      )

      for (let i = 0; i < sortedCluster.length; i++) {
        const currentService = sortedCluster[i]
        currentService.sequenceNumber = i + 1 // Add sequence number

        if (i > 0) {
          const previousService = sortedCluster[i - 1]
          const distance = await getDistance(currentService, previousService)
          currentService.distanceFromPrevious = distance
          currentService.previousCompany = previousService.company
        }
      }
    }

    return servicesWithDistance
  }, [])

  const fetchClusteredServices = useCallback(async () => {
    try {
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

      if (response.data.error) {
        console.error('Error fetching clustered services:', response.data.error)
        return
      }

      const servicesWithDistance = await addDistanceInfo(
        response.data.clusteredServices,
      )
      setClusteredServices(servicesWithDistance)
      setClusteringInfo(response.data.clusteringInfo)
    } catch (error) {
      console.error('Error fetching clustered services:', error)
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

  // Add new function to handle advancing dates
  const handleNextDay = useCallback(() => {
    const nextStart = new Date(startDate)
    nextStart.setDate(nextStart.getDate() + 1)
    const nextEnd = new Date(nextStart)
    nextEnd.setHours(nextEnd.getHours() + 10)

    setStartDate(nextStart.toISOString())
    setEndDate(nextEnd.toISOString())
  }, [startDate])

  // Update useEffect to recalculate endDate when startDate changes
  useEffect(() => {
    const end = new Date(startDate)
    end.setHours(end.getHours() + 10)
    setEndDate(end.toISOString())
  }, [startDate])

  function handlePointsChangeComplete() {
    fetchClusteredServices()
  }

  const optimizeSchedule = useCallback(
    async (services, distanceBias) => {
      setIsOptimizing(true)
      try {
        // Create a distance matrix for the services
        const distanceMatrix = []
        for (let i = 0; i < services.length; i++) {
          distanceMatrix[i] = []
          for (let j = 0; j < services.length; j++) {
            if (i === j) {
              distanceMatrix[i][j] = 0
            } else {
              distanceMatrix[i][j] = await getDistance(services[i], services[j])
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
        {
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
