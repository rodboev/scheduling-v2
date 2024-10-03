import { getRedisClient, ensureDistanceData } from '@/app/utils/redisClient'

const redis = getRedisClient()
const BATCH_SIZE = 50

export async function createDistanceMatrix(services) {
  // Validate services
  if (!Array.isArray(services) || services.length === 0) {
    console.error('Invalid services array:', services)
    return null
  }

  const pairs = []
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

      pairs.push([fromId, toId])
    }
  }

  let distances
  try {
    distances = await getDistances(pairs)
  } catch (error) {
    console.error('Error fetching distances:', error)
    return null
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
        const pairIndex = pairs.findIndex(
          pair =>
            (pair[0] === fromId && pair[1] === toId) ||
            (pair[0] === toId && pair[1] === fromId),
        )
        distanceMatrix[i][j] = pairIndex !== -1 ? distances[pairIndex] : null
      }
    }
  }

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

  const [distance] = await getDistances([[fromId, toId]])
  return distance
}

async function getDistances(pairs) {
  await ensureDistanceData()

  const pipeline = redis.pipeline()

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => (err ? null : parseFloat(result)))
}
