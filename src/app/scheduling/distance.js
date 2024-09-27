import { getDistances, getLocationInfo } from './redisClient.js'

const distanceCache = new Map()
const BATCH_SIZE = 50

export async function calculateDistancesForShift(shift) {
  const services = shift.services
  const pairs = []

  for (let i = 0; i < services.length; i++) {
    for (let j = i + 1; j < services.length; j++) {
      const fromId = services[i].location.id.toString()
      const toId = services[j].location.id.toString()
      const cacheKey = [fromId, toId].sort().join(',')

      if (!distanceCache.has(cacheKey)) {
        pairs.push([fromId, toId])
      }
    }
  }

  if (pairs.length > 0) {
    const distances = await getDistances(pairs)
    pairs.forEach((pair, index) => {
      const cacheKey = pair.sort().join(',')
      distanceCache.set(cacheKey, distances[index])
    })
  }

  const distanceMatrix = []
  for (let i = 0; i < services.length; i++) {
    distanceMatrix[i] = []
    for (let j = 0; j < services.length; j++) {
      if (i === j) {
        distanceMatrix[i][j] = 0
      } else {
        const fromId = services[i].location.id.toString()
        const toId = services[j].location.id.toString()
        const cacheKey = [fromId, toId].sort().join(',')
        distanceMatrix[i][j] = distanceCache.get(cacheKey) || null
      }
    }
  }

  return distanceMatrix
}

export async function calculateTravelDistance(fromService, toService) {
  if (!fromService?.location?.id || !toService?.location?.id) {
    console.warn(
      'Missing location id for service:',
      !fromService?.location?.id ? fromService?.id : toService?.id,
    )
    return null
  }

  const fromId = fromService.location.id.toString()
  const toId = toService.location.id.toString()

  const cacheKey = [fromId, toId].sort().join(',')

  if (distanceCache.has(cacheKey)) {
    return distanceCache.get(cacheKey)
  }

  const [distance] = await getDistances([[fromId, toId]])
  distanceCache.set(cacheKey, distance)

  return distance
}
