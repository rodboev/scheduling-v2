import axios from 'axios'
import { chunk } from '../../map/utils/array.js'
import { calculateTravelTime } from '../../map/utils/distance.js'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

// Helper function to get distances in batches
async function getDistances(pairs) {
  try {
    const chunkedPairs = chunk(pairs, 500)
    const allResults = []

    for (const pairChunk of chunkedPairs) {
      const response = await axios.get(`${BASE_URL}/api/distance`, {
        params: {
          id: pairChunk,
        },
        paramsSerializer: params => {
          return params.id.map(pair => `id=${pair}`).join('&')
        },
      })
      allResults.push(...response.data)
    }

    return allResults
  } catch (error) {
    console.error('Failed to get distances from API:', error)
    return null
  }
}

function calculateServiceScore(service, cluster, distanceMatrix, distanceBias = 50) {
  if (!cluster.length) return { score: 1, travelTime: 0 }

  const lastService = cluster[cluster.length - 1]
  const lastServiceIndex = service.index
  const currentServiceIndex = lastService.index
  
  // Get travel time from distance matrix
  const travelTime = distanceMatrix[lastServiceIndex][currentServiceIndex]
  
  // Calculate time gap between services
  const timeGap = service.time.range[0] - lastService.time.range[1]
  
  // Convert distanceBias (0-100) to weights
  const DISTANCE_WEIGHT = distanceBias / 100
  const TIME_WEIGHT = 1 - DISTANCE_WEIGHT
  
  // Normalize time gap (prefer smaller gaps but not too small)
  const idealGap = 15 * 60 * 1000 // 15 minutes
  const timeScore = Math.exp(-Math.abs(timeGap - idealGap) / (30 * 60 * 1000))
  
  // Normalize distance (prefer shorter travel times)
  const distanceScore = Math.exp(-travelTime / (30 * 60 * 1000))
  
  const score = (TIME_WEIGHT * timeScore) + (DISTANCE_WEIGHT * distanceScore)
  
  return { score, travelTime }
}

function createOptimizedClusters(services, distanceMatrix, distanceBias) {
  // Sort services by start time
  const sortedServices = [...services].sort((a, b) => 
    a.time.range[0] - b.time.range[0]
  )
  
  const clusters = []
  const MAX_CLUSTER_DURATION = 8 * 60 * 60 * 1000 // 8 hours in ms
  let remainingServices = [...sortedServices]
  let currentClusterIndex = 0

  while (remainingServices.length > 0) {
    // Start a new cluster with the earliest remaining service
    const firstService = remainingServices[0]
    let currentCluster = [{
      ...firstService,
      cluster: currentClusterIndex,
      sequenceNumber: 1
    }]
    
    let clusterStartTime = new Date(firstService.time.range[0])
    let clusterEndTime = new Date(firstService.time.range[1])
    let totalTravelTime = 0
    
    // Remove the first service from remaining services
    remainingServices = remainingServices.slice(1)
    
    // Try to add more services to this cluster
    let keepSearching = true
    while (keepSearching && remainingServices.length > 0) {
      keepSearching = false
      let bestServiceIndex = -1
      let bestScore = -1
      let bestTravelTime = 0

      // Look through remaining services to find the best next service
      for (let i = 0; i < remainingServices.length; i++) {
        const candidateService = remainingServices[i]
        const lastService = currentCluster[currentCluster.length - 1]
        
        // Calculate travel time from last service to candidate
        const travelTime = distanceMatrix[lastService.index][candidateService.index]
        
        // Calculate earliest possible start time considering travel
        const earliestStart = new Date(lastService.time.range[1].getTime() + travelTime)
        
        // Skip if service starts before possible or would exceed 8 hours
        if (new Date(candidateService.time.range[0]) < earliestStart ||
            new Date(candidateService.time.range[1]) > new Date(clusterStartTime.getTime() + MAX_CLUSTER_DURATION)) {
          continue
        }

        const { score } = calculateServiceScore(
          candidateService,
          currentCluster,
          distanceMatrix,
          distanceBias
        )

        if (score > bestScore) {
          bestScore = score
          bestServiceIndex = i
          bestTravelTime = travelTime
          keepSearching = true
        }
      }

      // Add the best service found to the cluster
      if (bestServiceIndex >= 0) {
        const serviceToAdd = remainingServices[bestServiceIndex]
        currentCluster.push({
          ...serviceToAdd,
          cluster: currentClusterIndex,
          sequenceNumber: currentCluster.length + 1
        })
        
        totalTravelTime += bestTravelTime
        clusterEndTime = new Date(serviceToAdd.time.range[1])
        remainingServices.splice(bestServiceIndex, 1)
      }
    }

    // Add the completed cluster
    clusters.push({
      services: currentCluster,
      totalTravelTime,
      startTime: clusterStartTime,
      endTime: clusterEndTime,
      size: currentCluster.length,
      clusterIndex: currentClusterIndex
    })
    
    currentClusterIndex++
  }

  return clusters
}

function calculateUtilization(cluster, totalTravelTime) {
  const duration = cluster[cluster.length - 1].time.range[1] - cluster[0].time.range[0]
  const serviceTime = cluster.reduce((total, service) => 
    total + (service.time.range[1] - service.time.range[0]), 0
  )
  return {
    duration,
    serviceTime,
    travelTime: totalTravelTime,
    utilizationRate: (serviceTime + totalTravelTime) / (8 * 60 * 60 * 1000)
  }
}

function createSingleCluster(services, distanceMatrix) {
  // Sort services by their preferred start time
  const sortedServices = [...services].sort((a, b) => 
    new Date(a.time.preferred) - new Date(b.time.preferred)
  )

  const cluster = []
  let currentEndTime = null

  for (const service of sortedServices) {
    const serviceStart = new Date(service.time.preferred)
    const serviceDuration = service.time.duration * 60 * 1000 // Convert minutes to milliseconds

    if (!currentEndTime || serviceStart >= currentEndTime) {
      // If this is the first service or there's no overlap
      cluster.push({
        ...service,
        start: service.time.preferred,
        end: new Date(serviceStart.getTime() + serviceDuration).toISOString(),
        cluster: 0,
        sequenceNumber: cluster.length + 1
      })
      currentEndTime = new Date(serviceStart.getTime() + serviceDuration)
    } else {
      // Try to schedule right after the previous service
      const newStart = new Date(currentEndTime.getTime() + 60000) // Add 1 minute buffer
      const newEnd = new Date(newStart.getTime() + serviceDuration)
      
      // Check if new end time is within 8 hours of first service
      const firstServiceStart = new Date(cluster[0].start)
      const eightHoursFromStart = new Date(firstServiceStart.getTime() + 8 * 60 * 60 * 1000)
      
      if (newEnd <= eightHoursFromStart) {
        cluster.push({
          ...service,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
          cluster: 0,
          sequenceNumber: cluster.length + 1
        })
        currentEndTime = newEnd
      }
    }
  }

  return cluster
}

export function scheduleServices(services, distanceMatrix, options = {}) {
  const { distanceBias = 50, singleCluster = false } = options

  if (singleCluster) {
    const clusteredServices = createSingleCluster(services, distanceMatrix)
    
    return {
      clusteredServices,
      clusteringInfo: {
        totalClusters: 1,
        totalServices: services.length,
        averageServicesPerCluster: clusteredServices.length,
        distanceBias,
        connectedPointsCount: clusteredServices.length,
        outlierCount: services.length - clusteredServices.length,
        clusterSizes: [clusteredServices.length],
        clusterTimes: [{
          start: clusteredServices[0]?.start,
          end: clusteredServices[clusteredServices.length - 1]?.end,
          duration: new Date(clusteredServices[clusteredServices.length - 1]?.end) - 
                   new Date(clusteredServices[0]?.start),
          services: clusteredServices.length
        }]
      }
    }
  }

  // Add indices to services for distance matrix lookup
  const indexedServices = services.map((service, index) => ({
    ...service,
    index,
    time: {
      ...service.time,
      range: service.time.range.map(t => new Date(t))
    }
  }))
  
  const clusters = createOptimizedClusters(indexedServices, distanceMatrix, distanceBias)
  
  // Create a flat array of all services with their cluster assignments
  const clusteredServices = clusters.flatMap(cluster => 
    cluster.services.map(service => ({
      ...service,
      time: {
        ...service.time,
        range: service.time.range.map(t => t.toISOString())
      },
      cluster: cluster.clusterIndex,
      sequenceNumber: service.sequenceNumber,
      clusterSize: cluster.size,
      totalClusters: clusters.length
    }))
  )

  // Sort by original index to maintain consistent order
  clusteredServices.sort((a, b) => a.index - b.index)

  return {
    clusteredServices,
    clusteringInfo: {
      totalClusters: clusters.length,
      totalServices: services.length,
      averageServicesPerCluster: services.length / clusters.length,
      distanceBias,
      connectedPointsCount: clusteredServices.length,
      outlierCount: 0,
      clusterSizes: clusters.map(c => c.size),
      clusterTimes: clusters.map(c => ({
        start: c.startTime.toISOString(),
        end: c.endTime.toISOString(),
        duration: c.endTime - c.startTime,
        services: c.size
      }))
    }
  }
}
