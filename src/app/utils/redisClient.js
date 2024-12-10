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
      retryStrategy: (times) => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`)
          return null // Stop retrying after 3 attempts
        }
        return Math.min(times * 100, 3000) // Increase delay between retries
      },
      connectTimeout: 10000, // 10 seconds
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      tls: redisUrl.includes('redislabs.com') ? { rejectUnauthorized: false } : undefined,
      reconnectOnError: function (err) {
        console.error('Redis reconnect on error:', err)
        return true // Always try to reconnect
      },
    }

    redis = new Redis(redisUrl, options)

    redis.on('error', (error) => {
      console.error('Redis connection error:', error)
    })

    redis.on('connect', () => {
      console.log('Successfully connected to Redis')
    })

    redis.on('reconnecting', () => {
      console.log('Reconnecting to Redis...')
    })

    redis.on('ready', () => {
      console.log('Redis client ready')
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

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => {
    if (err) {
      console.error('Error getting distance:', err)
      return null
    }
    return result ? Number.parseFloat(result) : null
  })
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
    const [posErr, pos] = results[index * 2]
    const [companyErr, company] = results[index * 2 + 1]

    if (posErr) {
      console.error(`Error getting position for ID ${id}:`, posErr)
      return null
    }

    return pos
      ? {
          id,
          company,
          location: {
            longitude: Number.parseFloat(pos[0][0]),
            latitude: Number.parseFloat(pos[0][1]),
          },
        }
      : null
  })
}

export async function storeLocations(serviceSetups) {
  const redis = getRedisClient()
  const pipeline = redis.pipeline()

  console.log('Starting location storage process...')
  console.log(`Total service setups to process: ${serviceSetups.length}`)

  // Clear existing data
  await redis.del('locations')
  await redis.del('company_names')
  console.log('Cleared existing location data')

  let validCount = 0
  let invalidCount = 0
  const processedLocations = new Set()
  const errors = []

  for (const setup of serviceSetups) {
    const { location, company } = setup
    if (!location?.id) {
      console.warn('Setup missing location ID:', setup)
      invalidCount++
      continue
    }

    if (processedLocations.has(location.id)) {
      continue
    }

    if (
      location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number'
    ) {
      try {
        await Promise.all([
          redis.geoadd('locations', location.longitude, location.latitude, location.id.toString()),
          redis.hset('company_names', location.id.toString(), company || ''),
        ])
        validCount++
        processedLocations.add(location.id)
      } catch (err) {
        console.error(`Failed to store location ${location.id}:`, err)
        errors.push({ id: location.id, error: err.message })
        invalidCount++
      }
    } else {
      console.warn(
        `Invalid location data for id ${location?.id}:`,
        `lat=${location?.latitude},`,
        `lon=${location?.longitude}`,
      )
      invalidCount++
    }
  }

  const finalCount = await redis.zcard('locations')
  console.log('Location storage complete:')
  console.log(`- Valid locations stored: ${validCount}`)
  console.log(`- Invalid/skipped: ${invalidCount}`)
  console.log(`- Final Redis count: ${finalCount}`)
  if (errors.length) {
    console.log('Storage errors:', errors)
  }

  return {
    validCount,
    invalidCount,
    finalCount,
    errors,
  }
}

export async function getLocations() {
  const redis = getRedisClient()
  try {
    // Check if locations are already loaded
    const locationCount = await redis.zcard('locations')
    console.log(`Current location count in Redis: ${locationCount}`)

    if (locationCount === 0) {
      console.log('Loading locations into Redis...')

      // Load service setups to get locations
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
      console.log(`Fetching service setups from: ${baseUrl}/api/serviceSetups`)

      const response = await axios.get(`${baseUrl}/api/serviceSetups`)
      const services = response.data

      if (!Array.isArray(services)) {
        throw new Error(`Invalid services data: ${typeof services}`)
      }

      console.log(`Loaded ${services.length} services for location data`)

      const result = await storeLocations(services)

      if (result.finalCount === 0) {
        throw new Error('Failed to store any locations in Redis')
      }

      return result.finalCount
    }

    return locationCount
  } catch (error) {
    console.error('Error in getLocations:', error)
    throw error
  }
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
