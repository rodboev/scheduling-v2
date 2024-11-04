import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

export async function getDistance(fromService, toService) {
  if (!fromService?.location?.id || !toService?.location?.id) {
    console.warn('Missing location IDs for distance calculation')
    return calculateHaversineDistance(
      fromService.location.latitude,
      fromService.location.longitude,
      toService.location.latitude,
      toService.location.longitude,
    )
  }

  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: {
        fromId: fromService.location.id.toString(),
        toId: toService.location.id.toString(),
      },
    })

    return (
      response.data?.distance ??
      calculateHaversineDistance(
        fromService.location.latitude,
        fromService.location.longitude,
        toService.location.latitude,
        toService.location.longitude,
      )
    )
  } catch (error) {
    console.error('Failed to get distance from API:', error)
    return calculateHaversineDistance(
      fromService.location.latitude,
      fromService.location.longitude,
      toService.location.latitude,
      toService.location.longitude,
    )
  }
}

export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959 // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function calculateTravelTime(lat1, lon1, lat2, lon2) {
  const R = 3959 // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distance = R * c

  // Assuming 20mph average speed
  return (distance / 20) * 60 // Returns travel time in minutes
}
