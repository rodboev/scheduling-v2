import { calculateTravelTime } from '../../map/utils/distance.js'
import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

// Helper function to get distances in batch from API
async function getDistancesFromAPI(pairs) {
  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: {
        id: pairs.map(([id1, id2]) => `${id1},${id2}`),
      },
      paramsSerializer: params => {
        return params.id.map(pair => `id=${pair}`).join('&')
      },
    })
    
    // Transform the response to match expected format
    return response.data.map(result => {
      if (!result || result.error) return null
      
      // Handle both single distance and array of distances
      const distance = Array.isArray(result.distance) 
        ? result.distance[0]?.distance
        : result.distance

      return {
        from: {
          id: result.from?.id,
          company: result.from?.company,
          location: result.from?.location
        },
        to: {
          id: result.to?.id,
          company: result.to?.company,
          location: result.to?.location
        },
        distance
      }
    })
  } catch (error) {
    console.error('Failed to get distances from API:', error)
    return pairs.map(([fromId, toId]) => ({
      from: { id: fromId },
      to: { id: toId },
      distance: null
    }))
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

  // Pre-calculate all distances for each cluster
  for (const [clusterId, clusterServices] of Object.entries(clusters)) {
    if (clusterServices.length <= 1) continue

    // Create pairs of consecutive services
    const pairs = []
    for (let i = 1; i < clusterServices.length; i++) {
      const prev = clusterServices[i - 1]
      const curr = clusterServices[i]
      pairs.push([
        prev.location.id.toString(),
        curr.location.id.toString()
      ])
    }

    // Get all distances in one batch from API
    const distances = await getDistancesFromAPI(pairs)

    // Schedule first service
    let currentService = clusterServices[0]
    currentService.start = currentService.time.preferred
    currentService.end = new Date(
      new Date(currentService.start).getTime() +
        currentService.time.duration * 60000,
    ).toISOString()

    // Schedule remaining services using pre-calculated distances
    for (let i = 1; i < clusterServices.length; i++) {
      const prevService = clusterServices[i - 1]
      currentService = clusterServices[i]
      const distance = distances[i - 1]?.distance
      const travelTime = distance || calculateTravelTime(
        prevService.location.latitude,
        prevService.location.longitude,
        currentService.location.latitude,
        currentService.location.longitude,
      )

      const prevEndTime = new Date(prevService.end)
      const earliestStart = new Date(prevEndTime)
      earliestStart.setMinutes(earliestStart.getMinutes() + travelTime)

      currentService.start = new Date(
        Math.max(earliestStart, new Date(currentService.time.preferred)),
      ).toISOString()

      currentService.end = new Date(
        new Date(currentService.start).getTime() +
          currentService.time.duration * 60000,
      ).toISOString()
    }
  }

  return services
}
