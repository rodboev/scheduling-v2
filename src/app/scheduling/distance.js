import axios from 'axios'

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
        pairs.push(cacheKey)
      }
    }
  }

  if (pairs.length > 0) {
    await fetchDistances(pairs)
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

async function fetchDistances(pairs) {
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE)
    try {
      console.log('Fetching distances for', batch)
      const response = await axios.get(
        `http://localhost:${process.env.PORT}/api/distance?${batch
          .map(key => `id=${key}`)
          .join('&')}`,
      )

      for (const result of response.data) {
        if (result.error) {
          console.warn(
            `Error for pair ${result.from.id},${result.distance[0].id}: ${result.error}`,
          )
          distanceCache.set(`${result.from.id},${result.distance[0].id}`, null)
        } else {
          const cacheKey = `${result.from.id},${result.distance[0].id}`
          distanceCache.set(cacheKey, result.distance[0].distance)
        }
      }
    } catch (error) {
      console.error('Error fetching distances:', error)
      for (const key of batch) {
        distanceCache.set(key, null)
      }
    }
  }
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

  // Create a unique key for the pair of locations
  const cacheKey = [fromId, toId].sort().join(',')

  // Check if the distance is already in the cache
  if (distanceCache.has(cacheKey)) {
    return distanceCache.get(cacheKey)
  }

  // If not in cache, fetch it
  await fetchDistances([cacheKey])

  return distanceCache.get(cacheKey)
}
