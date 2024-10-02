import Redis from 'ioredis'
import { readFromDiskCache } from '../utils/diskCache.js'

const redis = new Redis(process.env.REDIS_URL)

async function generateAndStoreDistances(serviceSetups) {
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

async function ensureDistanceData() {
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

export async function getDistances(pairs) {
  await ensureDistanceData()

  const pipeline = redis.pipeline()

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => (err ? null : parseFloat(result)))
}

export async function getLocationInfo(ids) {
  await ensureDistanceData()

  const pipeline = redis.pipeline()

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
            longitude: parseFloat(pos[0]),
            latitude: parseFloat(pos[1]),
          },
        }
      : null
  })
}

export async function closeRedisConnection() {
  await redis.quit()
}
