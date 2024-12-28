import {
  getRedisClient,
  getLocations,
  getCachedData,
  setCachedData,
  getDistances,
} from './redisClient.js'

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
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

async function getDistanceBetweenLocations(fromId, toId) {
  const redis = getRedisClient()
  const [fromLocation] = await redis.geopos('locations', fromId)
  const [toLocation] = await redis.geopos('locations', toId)

  if (!fromLocation || !toLocation) {
    console.warn('Missing location data for distance calculation:', { fromId, toId })
    return null
  }

  // Redis GEOPOS returns [longitude, latitude]
  return calculateHaversineDistance(
    fromLocation[1], // lat1
    fromLocation[0], // lon1
    toLocation[1], // lat2
    toLocation[0], // lon2
  )
}

export async function createDistanceMatrix(services) {
  // Validate services
  if (!Array.isArray(services) || services.length === 0) {
    console.warn(
      `Invalid services array: expected non-empty array, got ${Array.isArray(services) ? 'empty array' : typeof services}`,
    )
    return []
  }

  const cacheKey = `distanceMatrix:${services.map(s => s.id).join(',')}`
  const cachedMatrix = getCachedData(cacheKey)

  if (cachedMatrix) {
    return cachedMatrix
  }

  await getLocations() // Ensure locations are loaded in Redis

  // Initialize matrix with zeros on diagonal
  const distanceMatrix = Array(services.length)
    .fill()
    .map((_, i) => Array(services.length).fill(0))

  // Create pairs for parallel processing
  const pairs = []
  for (let i = 0; i < services.length; i++) {
    for (let j = i + 1; j < services.length; j++) {
      const fromId = services[i].location?.id?.toString()
      const toId = services[j].location?.id?.toString()
      if (fromId && toId) {
        pairs.push({ fromId, toId, i, j })
      }
    }
  }

  // Process in chunks of 50 pairs
  const CHUNK_SIZE = 50
  for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
    const chunk = pairs.slice(i, i + CHUNK_SIZE)
    const results = await Promise.all(
      chunk.map(async ({ fromId, toId, i, j }) => {
        const distance = await getDistanceBetweenLocations(fromId, toId)
        return { i, j, distance }
      }),
    )

    // Fill matrix with results
    for (const { i, j, distance } of results) {
      if (distance !== null) {
        distanceMatrix[i][j] = distance
        distanceMatrix[j][i] = distance // Mirror the distance
      }
    }
  }

  setCachedData(cacheKey, distanceMatrix)
  return distanceMatrix
}

export async function getDistanceBetweenServices(fromService, toService) {
  if (!fromService?.location?.id || !toService?.location?.id) {
    console.warn(
      'Missing location id for service:',
      !fromService?.location?.id ? fromService?.id : toService?.id,
    )
    return null
  }

  const fromId = fromService.location.id.toString()
  const toId = toService.location.id.toString()

  return getDistanceBetweenLocations(fromId, toId)
}
