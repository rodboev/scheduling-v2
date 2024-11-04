import axios from 'axios'
import { calculateTravelTime } from '../../map/utils/distance.js'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

// Helper function to get distance using API
async function getDistance(fromService, toService) {
  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: {
        fromId: fromService.location.id.toString(),
        toId: toService.location.id.toString(),
      },
    })
    return response.data.distance
  } catch (error) {
    console.error('Failed to get distance from API:', error)
    // Fallback to Haversine
    return calculateTravelTime(
      fromService.location.latitude,
      fromService.location.longitude,
      toService.location.latitude,
      toService.location.longitude,
    )
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

    // Schedule remaining services
    for (let i = 1; i < clusterServices.length; i++) {
      const prevService = clusterServices[i - 1]
      currentService = clusterServices[i]

      // Calculate earliest possible start time
      const prevEndTime = new Date(prevService.end)

      const travelTime = await getDistance(prevService, currentService)
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
