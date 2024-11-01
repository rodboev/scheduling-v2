import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const locationDistanceCache = new Map()

function getLocationCacheKey(fromId, toId) {
  return [fromId, toId].sort().join(',')
}

async function getDistanceBetweenLocations(fromId, toId) {
  const cacheKey = getLocationCacheKey(fromId, toId)

  // Check cache first
  if (locationDistanceCache.has(cacheKey)) {
    return locationDistanceCache.get(cacheKey)
  }

  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: { fromId, toId },
    })
    const distance = response.data.distance
    locationDistanceCache.set(cacheKey, distance)
    return distance
  } catch (error) {
    console.error('Failed to get distance from API:', error)
    return null
  }
}

export async function createDistanceMatrix(services) {
  if (!Array.isArray(services) || services.length === 0) {
    console.warn('Invalid services array')
    return []
  }

  // Create a map of unique locations and their indices in the services array
  const uniqueLocations = new Map()
  const locationIndices = new Map()

  services.forEach((service, index) => {
    if (service.location?.id) {
      const locId = service.location.id.toString()
      uniqueLocations.set(locId, service.location)
      if (!locationIndices.has(locId)) {
        locationIndices.set(locId, [])
      }
      locationIndices.get(locId).push(index)
    }
  })

  // Create distance matrix between unique locations
  const locationIds = Array.from(uniqueLocations.keys())
  const uniqueDistances = []

  for (let i = 0; i < locationIds.length; i++) {
    uniqueDistances[i] = []
    for (let j = 0; j < locationIds.length; j++) {
      if (i === j) {
        uniqueDistances[i][j] = 0
        continue
      }
      uniqueDistances[i][j] = await getDistanceBetweenLocations(
        locationIds[i],
        locationIds[j],
      )
    }
  }

  // Expand the unique distances matrix to full service matrix
  const distanceMatrix = Array(services.length)
    .fill()
    .map(() => Array(services.length))

  for (let i = 0; i < services.length; i++) {
    for (let j = 0; j < services.length; j++) {
      if (i === j) {
        distanceMatrix[i][j] = 0
        continue
      }

      const fromId = services[i].location?.id?.toString()
      const toId = services[j].location?.id?.toString()

      if (!fromId || !toId) {
        distanceMatrix[i][j] = null
        continue
      }

      const fromIndex = locationIds.indexOf(fromId)
      const toIndex = locationIds.indexOf(toId)
      distanceMatrix[i][j] = uniqueDistances[fromIndex][toIndex]
    }
  }

  return distanceMatrix
}

export async function getDistanceBetweenServices(fromService, toService) {
  if (!fromService?.location?.id || !toService?.location?.id) {
    console.warn('Missing location id for service')
    return null
  }

  // Services at same location have zero distance
  if (fromService.location.id === toService.location.id) return 0

  return getDistanceBetweenLocations(
    fromService.location.id.toString(),
    toService.location.id.toString(),
  )
}

// Keep existing Haversine fallback functions
function createHaversineMatrix(services) {
  const matrix = []
  for (let i = 0; i < services.length; i++) {
    matrix[i] = []
    for (let j = 0; j < services.length; j++) {
      if (i === j) {
        matrix[i][j] = 0
        continue
      }

      matrix[i][j] = calculateTravelTime(
        services[i].location.latitude,
        services[i].location.longitude,
        services[j].location.latitude,
        services[j].location.longitude,
      )
    }
  }
  return matrix
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
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
  // Haversine formula implementation
  const R = 3959 // Earth's radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(value) {
  return (value * Math.PI) / 180
}
