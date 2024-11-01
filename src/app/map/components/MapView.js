'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { scheduleServices } from '@/app/api/cluster/scheduling'
import MapMarker from '@/app/map/components/MapMarker'
import MapPopup from '@/app/map/components/MapPopup'
import MapTools from '@/app/map/components/MapTools'
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
  // State for services and clustering
  const [clusteredServices, setClusteredServices] = useState([])
  const [clusteringInfo, setClusteringInfo] = useState(null)
  const [clusterUnclustered, setClusterUnclustered] = useState(true)
  const [minPoints, setMinPoints] = useState(8) // Default min points
  const [maxPoints, setMaxPoints] = useState(16) // Default max points

  // UI state
  const [activePopup, setActivePopup] = useState(null)
  const [startDate, setStartDate] = useState('2024-09-03T02:30:00.000Z')
  const [endDate, setEndDate] = useState('2024-09-03T10:30:00.000Z')
  const center = [40.72, -73.97] // BK: [40.687, -73.965]
  const markerRefs = useRef({})

  // Clustering algorithm selection
  const [algorithm, setAlgorithm] = useState('kmeans')

  // Distance vs time optimization bias (0% = time priority, 100% = distance priority)
  const [distanceBias, setDistanceBias] = useState(50)
  const [isRescheduling, setIsRescheduling] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)

  // Add new state for tracking unscheduled services
  const [unassignedServices, setUnassignedServices] = useState([])

  /**
   * Debounced reschedule function to prevent excessive calculations
   * Wrapped in useCallback to maintain reference stability
   */
  const debouncedReschedule = useCallback(
    debounce(async (services, shouldClusterNoise, bias, min, max) => {
      try {
        const rescheduled = await scheduleServices(
          services,
          shouldClusterNoise,
          bias,
          min,
          max,
        )
        logSchedule(rescheduled)
        setClusteredServices(rescheduled)
      } catch (error) {
        console.error('Error rescheduling services:', error)
      } finally {
        setIsOptimizing(false)
      }
    }, 500),
    [], // Empty deps since we don't want to recreate the debounced function
  )

  /**
   * Wrapper function to handle rescheduling state
   */
  async function rescheduleServices() {
    if (!clusteredServices?.length || isOptimizing) return

    setIsOptimizing(true)
    try {
      const rescheduled = await scheduleServices(
        [...clusteredServices],
        clusterUnclustered,
        distanceBias,
        minPoints,
        maxPoints,
      )

      // If we get back the original services, it means we timed out
      if (rescheduled === clusteredServices) {
        console.log('Optimization timed out - reverting to previous state')
        setDistanceBias(previousDistanceBias.current)
      } else {
        logSchedule(rescheduled)
        setClusteredServices(rescheduled)
      }
    } catch (error) {
      console.error('Error rescheduling services:', error)
      setDistanceBias(previousDistanceBias.current)
    } finally {
      setIsOptimizing(false)
    }
  }

  /**
   * Fetches clustered services from the API
   * - Gets services from Redis within time range
   * - Applies clustering algorithm (DBSCAN/K-means)
   * - Handles scheduling optimization
   * - Updates UI with results
   */
  async function fetchClusteredServices(isInitialLoad = false) {
    console.log(`Fetching services (initial: ${isInitialLoad})`)
    try {
      const response = await axios.get('/api/cluster', {
        params: {
          start: startDate,
          end: endDate,
          clusterUnclustered,
          minPoints,
          maxPoints,
          algorithm,
          // Convert percentage to decimal
          distanceBias: distanceBias / 100,
        },
      })

      if (response.data.error) {
        console.error('Error:', response.data.error)
        return
      }

      const {
        scheduledServices = [],
        unassignedServices = [],
        clusteringInfo,
      } = response.data

      console.log(
        `Setting ${scheduledServices?.length || 0} services, ${unassignedServices?.length || 0} unassigned`,
      )

      // Add null checks when setting state
      setClusteredServices(scheduledServices || [])
      setUnassignedServices(unassignedServices || [])
      setClusteringInfo(clusteringInfo || null)

      if (scheduledServices?.length) {
        logSchedule(scheduledServices)
      }
    } catch (error) {
      console.error('Error fetching services:', error)
      // Set empty arrays on error to prevent undefined
      setClusteredServices([])
      setUnassignedServices([])
      setClusteringInfo(null)
    }
  }

  // Remove the isInitialLoadRef logic and replace with this simpler initialization
  useEffect(() => {
    console.log('Initial fetch of clustered services')
    fetchClusteredServices(true)
  }, []) // Run once on mount

  // Simplify the dependency effect to prevent double fetching
  useEffect(() => {
    if (clusteredServices.length > 0) {
      console.log('Rescheduling existing services')
      rescheduleServices()
    }
  }, [startDate, endDate, clusterUnclustered, algorithm, minPoints, maxPoints])

  function handleMapClick() {
    if (activePopup) {
      markerRefs.current[activePopup]?.closePopup()
      setActivePopup(null)
    }
  }

  function updateServiceEnforcement(serviceId, checked) {
    console.log(`Updating service ${serviceId} enforcement to ${checked}`)
  }

  function handleMinPointsChange(value) {
    setMinPoints(value)
  }

  function handleMaxPointsChange(value) {
    setMaxPoints(value)
  }

  function handlePointsChangeComplete() {
    fetchClusteredServices()
  }

  // Memoize the services rendering to prevent unnecessary recalculations
  const renderedServices = useMemo(() => {
    if (!clusteredServices?.length) return null

    const groupedServices = clusteredServices.reduce((groups, service) => {
      if (service.cluster >= 0) {
        if (!groups[service.cluster]) {
          groups[service.cluster] = []
        }
        groups[service.cluster].push(service)
      } else {
        // Handle outliers and noise points
        if (!groups.unclustered) {
          groups.unclustered = []
        }
        groups.unclustered.push(service)
      }
      return groups
    }, {})

    return Object.entries(groupedServices).flatMap(([cluster, services]) => {
      if (cluster === 'unclustered') {
        // Don't number unclustered points
        return services.map(service => (
          <MapMarker
            key={service.id}
            service={service}
            markerRefs={markerRefs}
            activePopup={activePopup}
            setActivePopup={setActivePopup}
          >
            <MapPopup
              service={service}
              updateServiceEnforcement={updateServiceEnforcement}
            />
          </MapMarker>
        ))
      }

      // Number the points within each cluster
      return services.map((service, index) => (
        <MapMarker
          key={service.id}
          service={service}
          markerRefs={markerRefs}
          activePopup={activePopup}
          setActivePopup={setActivePopup}
          index={index + 1}
        >
          <MapPopup
            service={service}
            updateServiceEnforcement={updateServiceEnforcement}
          />
        </MapMarker>
      ))
    })
  }, [clusteredServices, activePopup]) // Only re-render when these dependencies change

  const handleOptimizationChange = useCallback(
    async newBias => {
      setIsOptimizing(true)
      try {
        await fetchClusteredServices(false)
      } finally {
        setIsOptimizing(false)
      }
    },
    [fetchClusteredServices],
  )

  return (
    <div className="relative h-screen w-screen">
      <MapTools
        algorithm={algorithm}
        setAlgorithm={setAlgorithm}
        minPoints={minPoints}
        setMinPoints={handleMinPointsChange}
        maxPoints={maxPoints}
        setMaxPoints={handleMaxPointsChange}
        onPointsChangeComplete={handlePointsChangeComplete}
        clusterUnclustered={clusterUnclustered}
        setClusterUnclustered={setClusterUnclustered}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
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
        attributionControl={false}
      >
        <MapEventHandler setActivePopup={setActivePopup} />
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`}
          attribution=""
        />
        {renderedServices}
      </MapContainer>

      {(clusteringInfo || unassignedServices.length > 0) && (
        <div
          className="absolute bottom-4 right-4 z-[1000] hidden space-y-2 rounded bg-white px-4 py-3
            shadow md:block"
        >
          <p>Runtime: {clusteringInfo?.performanceDuration} ms</p>
          <p>Total Services: {clusteringInfo?.totalServices || 0}</p>
          <p>Assigned: {clusteringInfo?.assignedCount || 0}</p>
          {unassignedServices.length > 0 && (
            <div className="border-t border-gray-200 pt-2">
              <p className="font-medium">
                Unassigned Services ({unassignedServices.length}):
              </p>
              <div className="max-h-32 overflow-y-auto">
                {unassignedServices.map(service => (
                  <div
                    key={service.id}
                    className="text-sm text-gray-600"
                  >
                    {service.company} -{' '}
                    {new Date(service.time.preferred).toLocaleTimeString()}
                    {service.reason && (
                      <span className="ml-1 text-xs text-gray-500">
                        ({service.reason})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MapView
