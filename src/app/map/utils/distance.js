import axios from 'axios'
import { HARD_MAX_RADIUS_MILES } from '@/app/utils/constants'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

// Get distances for a set of locations
export async function getDistances(locationPairs) {
  if (!locationPairs?.length) return {}

  // Get unique location IDs
  const locationIds = [...new Set(locationPairs.flatMap(pair => [pair.from.id, pair.to.id]))]

  // Get the full distance matrix
  const response = await axios.get(`${BASE_URL}/api/distance-matrix`, {
    params: { ids: locationIds.join(',') },
  })
  const matrix = response.data

  // Map the results back to the original pairs format
  const results = locationPairs.map(pair => {
    const key = `${pair.from.id},${pair.to.id}`
    const distance = matrix[key]
    return {
      from: pair.from,
      to: pair.to,
      distance: distance !== null && distance <= HARD_MAX_RADIUS_MILES ? distance : null,
    }
  })

  return results
}

// Calculate haversine distance between two points
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
