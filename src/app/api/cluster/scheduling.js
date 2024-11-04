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

export async function scheduleServices(
  services,
  shouldClusterNoise = true,
  distanceBias = 50,
  minPoints = 4,
  maxPoints = 24,
  distanceMatrix = null,
) {
  // Group services by cluster
  const clusters = services.reduce((acc, service) => {
    if (service.cluster >= 0) {
      if (!acc[service.cluster]) acc[service.cluster] = []
      acc[service.cluster].push(service)
    }
    return acc
  }, {})

  // Schedule each cluster
  for (const [clusterId, clusterServices] of Object.entries(clusters)) {
    // Sort by preferred time
    clusterServices.sort(
      (a, b) => new Date(a.time.preferred) - new Date(b.time.preferred),
    )

    // Schedule first service at its preferred time
    let currentService = clusterServices[0]
    currentService.start = currentService.time.preferred
    currentService.end = new Date(
      new Date(currentService.start).getTime() +
        currentService.time.duration * 60000,
    ).toISOString()

    // Create pairs for all sequential services in the cluster
    const pairs = []
    for (let i = 1; i < clusterServices.length; i++) {
      const prevService = clusterServices[i - 1]
      currentService = clusterServices[i]
      pairs.push(`${prevService.location.id},${currentService.location.id}`)
    }

    // Get all distances at once
    const distanceResults = await getDistances(pairs)

    // Schedule remaining services using the fetched distances
    for (let i = 1; i < clusterServices.length; i++) {
      const prevService = clusterServices[i - 1]
      currentService = clusterServices[i]

      // Find the distance result for this pair
      const pairResult = distanceResults?.find(
        result =>
          result.from.id ===
          `${prevService.location.id},${currentService.location.id}`,
      )

      // Calculate travel time
      let travelTime
      if (pairResult?.distance?.[0]?.distance) {
        travelTime = pairResult.distance[0].distance
      } else {
        // Fallback to Haversine
        travelTime = calculateTravelTime(
          prevService.location.latitude,
          prevService.location.longitude,
          currentService.location.latitude,
          currentService.location.longitude,
        )
      }

      // Calculate earliest possible start time
      const prevEndTime = new Date(prevService.end)
      const earliestStart = new Date(prevEndTime)
      earliestStart.setMinutes(earliestStart.getMinutes() + travelTime)

      // Set start time to either earliest possible or preferred time
      currentService.start = new Date(
        Math.max(earliestStart, new Date(currentService.time.preferred)),
      ).toISOString()

      // Set end time based on duration
      currentService.end = new Date(
        new Date(currentService.start).getTime() +
          currentService.time.duration * 60000,
      ).toISOString()
    }
  }

  return services
}
