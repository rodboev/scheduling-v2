import axios from 'axios'
import Redis from 'ioredis'
import NodeCache from 'node-cache'

let redis
const memoryCache = new NodeCache({ stdTTL: 3600 }) // Cache for 1 hour

export function getRedisClient() {
  if (!redis) {
    const redisUrl = process.env.REDISCLOUD_URL || 'redis://localhost:6379'
    if (!redisUrl) {
      throw new Error('Error: REDISCLOUD_URL environment variable is not set')
    }

    console.log(`Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, '//')}`) // Hide credentials in logs

    const options = {
      retryStrategy: times => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`)
          return null // Stop retrying after 3 attempts
        }
        return Math.min(times * 100, 3000) // Increase delay between retries
      },
      connectTimeout: 10000, // 10 seconds
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      tls: redisUrl.includes('redislabs.com')
        ? { rejectUnauthorized: false }
        : undefined,
    }

    redis = new Redis(redisUrl, options)

    redis.on('error', error => {
      console.error('Redis connection error:', error)
    })

    redis.on('connect', () => {
      console.log('Successfully connected to Redis')
    })
  }
  return redis
}

export async function closeRedisConnection() {
  if (redis) {
    try {
      await redis.quit()
    } catch (error) {
      console.error('Error closing Redis connection:', error)
    } finally {
      redis = null
      console.log('Redis connection closed')
    }
  }
}

export async function getDistances(pairs) {
  const client = getRedisClient()
  const pipeline = client.pipeline()
  const cacheResults = []
  const uncachedPairs = []
  const uncachedIndices = []

  // Check cache first
  for (let i = 0; i < pairs.length; i++) {
    const [id1, id2] = pairs[i]
    const cacheKey = `distance:${id1},${id2}`
    const cachedResult = getCachedData(cacheKey)
    
    if (cachedResult) {
      cacheResults[i] = cachedResult
    } else {
      uncachedPairs.push(pairs[i])
      uncachedIndices.push(i)
      pipeline.geodist('locations', id1, id2, 'mi')
    }
  }

  // Only make Redis call if there are uncached values
  if (uncachedPairs.length > 0) {
    const results = await pipeline.exec()
    
    // Process results and update cache
    results.forEach(([err, result], index) => {
      const actualIndex = uncachedIndices[index]
      const [id1, id2] = uncachedPairs[index]
      const distance = err ? null : Number.parseFloat(result)
      
      cacheResults[actualIndex] = distance
      
      if (distance !== null) {
        setCachedData(`distance:${id1},${id2}`, distance)
      }
    })
  }

  return cacheResults
}

export async function getLocationInfo(ids) {
  const client = getRedisClient()
  const pipeline = client.pipeline()

  for (const id of ids) {
    pipeline.geopos('locations', id)
    pipeline.hget('company_names', id)
  }

  const results = await pipeline.exec()
  return ids.map((id, index) => {
    const [, pos] = results[index * 2]
    const [, company] = results[index * 2 + 1]
    return pos
      ? {
          id,
          company,
          location: {
            longitude: Number.parseFloat(pos[0]),
            latitude: Number.parseFloat(pos[1]),
          },
        }
      : null
  })
}

export async function storeLocations(serviceSetups) {
  const redis = getRedisClient()
  const pipeline = redis.pipeline()

  // Clear existing data
  pipeline.del('locations')
  pipeline.del('company_names')

  let validCount = 0
  let invalidCount = 0
  const processedLocations = new Set()

  for (const setup of serviceSetups) {
    const { location, company } = setup
    if (
      location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number' &&
      !processedLocations.has(location.id)
    ) {
      pipeline.geoadd(
        'locations',
        location.longitude,
        location.latitude,
        location.id.toString(),
      )
      pipeline.hset('company_names', location.id.toString(), company)
      validCount++
      processedLocations.add(location.id)
    } else if (!processedLocations.has(location.id)) {
      console.warn(`Invalid location data for id ${location.id}. Skipping.`)
      invalidCount++
    }
  }
  await pipeline.exec()

  console.log(
    `Locations and company names stored in Redis. Valid: ${validCount}, Invalid: ${invalidCount}`,
  )
}

export async function getLocations() {
  const cacheKey = 'locationCount'
  const cachedLocationCount = memoryCache.get(cacheKey)

  if (cachedLocationCount !== undefined) {
    return cachedLocationCount
  }

  const redis = getRedisClient()
  const locationCount = await redis.zcard('locations')

  if (locationCount === 0) {
    console.log('Regenerating distance data...')
    let serviceSetups

    try {
      const response = await axios.get(
        `http://localhost:${process.env.PORT}/api/serviceSetups`,
      )
      serviceSetups = response.data
      console.log('Fetched service setups:', serviceSetups.length)
    } catch (error) {
      console.error('Error fetching service setups:', error)
      throw new Error('Unable to fetch service setups')
    }

    if (!serviceSetups || !Array.isArray(serviceSetups)) {
      throw new Error('Invalid service setups data format')
    }

    await storeLocations(serviceSetups)
    console.log('Distance data regenerated and saved to Redis')
  }

  memoryCache.set(cacheKey, locationCount)
  return locationCount
}

export function getCachedData(key) {
  return memoryCache.get(key)
}

export function setCachedData(key, data, ttl = 300) {
  const defaultTTL = 300
  let actualTTL = ttl

  if (key.startsWith('location:')) {
    actualTTL = 86400 // 1 day for location data
  } else if (key.startsWith('distanceMatrix:')) {
    actualTTL = 3600 // 1 hour for distance matrix
  }

  memoryCache.set(key, data, actualTTL)
}

export function deleteCachedData(key) {
  memoryCache.del(key)
}
