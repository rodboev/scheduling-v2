import {
  getRedisClient,
  getLocations,
  getCachedData,
  setCachedData,
  getDistances,
} from './redisClient.js'

async function getDistanceBetweenLocations(fromId, toId) {
  const [distance] = await getDistances([[fromId, toId]])
  return distance
}

export async function createDistanceMatrix(services) {
  // Validate services
  if (!Array.isArray(services) || services.length === 0) {
    console.warn(
      `Invalid services array: expected non-empty array, got ${Array.isArray(services) ? 'empty array' : typeof services}`,
    )
    return []
  }

  const cacheKey = `distanceMatrix:${services.map((s) => s.id).join(',')}`
  const cachedMatrix = getCachedData(cacheKey)

  if (cachedMatrix) {
    return cachedMatrix
  }

  await getLocations() // Ensure locations are loaded in Redis

  const distanceMatrix = []
  for (let i = 0; i < services.length; i++) {
    distanceMatrix[i] = []
    for (let j = 0; j < services.length; j++) {
      if (i === j) {
        distanceMatrix[i][j] = 0
      } else {
        const fromId = services[i].location?.id?.toString()
        const toId = services[j].location?.id?.toString()
        if (!fromId || !toId) {
          distanceMatrix[i][j] = null
          continue
        }
        distanceMatrix[i][j] = await getDistanceBetweenLocations(fromId, toId)
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
