import Redis from 'ioredis'
import { readFromDiskCache } from './diskCache'

let redis

export function getRedisClient() {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set')
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
    const serviceSetups = await readFromDiskCache({
      file: 'serviceSetups.json',
    })
    if (!serviceSetups || !Array.isArray(serviceSetups)) {
      throw new Error('Unable to read service setups or invalid data format')
    }
    await generateAndStoreDistances(serviceSetups)
    console.log('Distance data regenerated and saved')
  }

  return locationCount
}
