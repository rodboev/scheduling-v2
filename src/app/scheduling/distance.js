// /src/app/scheduling/distance.js
import { getDistances, getLocationInfo } from './redisClient.js'

const distanceCache = new Map()
const BATCH_SIZE = 50

export async function calculateDistancesForShift(shift) {
  const services = shift.services
  const pairs = []

  // Validate services
  if (!Array.isArray(services) || services.length === 0) {
    console.error('Invalid services array:', services)
    return null
  }

  for (let i = 0; i < services.length; i++) {
    for (let j = i + 1; j < services.length; j++) {
      const fromId = services[i].location?.id?.toString()
      const toId = services[j].location?.id?.toString()

      if (!fromId || !toId) {
        console.error(
          `Missing location id for service:`,
          !fromId ? services[i].id : services[j].id,
        )
        continue
      }

      const cacheKey = [fromId, toId].sort().join(',')

      if (!distanceCache.has(cacheKey)) {
        pairs.push([fromId, toId])
      }
    }
  }

  if (pairs.length > 0) {
    try {
      const distances = await getDistances(pairs)
      pairs.forEach((pair, index) => {
        const cacheKey = pair.sort().join(',')
        distanceCache.set(cacheKey, distances[index])
      })
    } catch (error) {
      console.error('Error fetching distances:', error)
      return null
    }
  }

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
        const cacheKey = [fromId, toId].sort().join(',')
        distanceMatrix[i][j] = distanceCache.get(cacheKey) ?? null
      }
    }
  }

  // console.log(
  //   `Distance Matrix for Shift: ${shift.shiftStart} - ${shift.shiftEnd}`,
  // )
  // console.table(distanceMatrix)

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
