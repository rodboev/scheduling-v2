import axios from 'axios'
import Redis from 'ioredis'
import { readFromDiskCache } from './diskCache.js'

let redis

export function getRedisClient() {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    if (!redisUrl) {
      throw new Error('Error: REDIS_URL environment variable is not set')
    } else {
      console.log(`Connecting: ${redisUrl}`)
    }
    redis = new Redis(redisUrl)

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
    await redis.quit()
    redis = null
    console.log('Redis connection closed')
  }
}

export async function generateAndStoreDistances(serviceSetups) {
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

export async function ensureDistanceData() {
  const redis = getRedisClient()
  const locationCount = await redis.zcard('locations')

  if (locationCount === 0) {
    console.log('Regenerating distance data...')
    let serviceSetups

    // Fetch from API directly
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

    await generateAndStoreDistances(serviceSetups)
    console.log('Distance data regenerated and saved to Redis')
  }

  return locationCount
}
