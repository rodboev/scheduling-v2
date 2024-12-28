import axios from 'axios'
import Redis from 'ioredis'
import NodeCache from 'node-cache'
import { calculateHaversineDistance } from '../map/utils/distance.js'
import { HARD_MAX_RADIUS_MILES } from './constants.js'

let redis
const memoryCache = new NodeCache({ stdTTL: 3600 }) // Cache for 1 hour

// Add a centralized distance calculation function
async function getVerifiedDistance(redis, id1, id2) {
  const [geopos, distance] = await Promise.all([
    redis.geopos('locations', id1, id2),
    redis.geodist('locations', id1, id2, 'mi'),
  ])

  if (!distance || !geopos?.[0] || !geopos?.[1]) {
    return null
  }

  const redisDistance = Number.parseFloat(distance)
  const [[lon1, lat1], [lon2, lat2]] = geopos
  const haversineDistance = calculateHaversineDistance(
    Number(lat1),
    Number(lon1),
    Number(lat2),
    Number(lon2),
  )

  // Always use Haversine if Redis distance exceeds cap
  if (redisDistance > HARD_MAX_RADIUS_MILES || haversineDistance > HARD_MAX_RADIUS_MILES) {
    if (Math.abs(redisDistance - haversineDistance) > 0.1) {
      console.log(`Distance discrepancy for ${id1},${id2}:`, {
        redis: redisDistance,
        haversine: haversineDistance,
        difference: Math.abs(redisDistance - haversineDistance),
      })
    }
    return haversineDistance
  }

  return redisDistance
}

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
      tls: redisUrl.includes('redislabs.com') ? { rejectUnauthorized: false } : undefined,
      reconnectOnError: function (err) {
        console.error('Redis reconnect on error:', err)
        return true // Always try to reconnect
      },
    }

    redis = new Redis(redisUrl, options)

    redis.on('error', error => {
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
  const distances = []

  // Process in smaller batches to avoid overwhelming Redis
  const BATCH_SIZE = 10
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, Math.min(i + BATCH_SIZE, pairs.length))
    const batchDistances = await Promise.all(
      batch.map(([id1, id2]) => getVerifiedDistance(client, id1, id2)),
    )
    distances.push(...batchDistances)
  }

  return distances
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
  console.log('Starting location storage process...')
  console.log(`Total service setups to process: ${serviceSetups.length}`)

  // Get existing locations before clearing
  const existingLocations = await redis.zrange('locations', 0, -1)
  console.log(`Existing locations in Redis before clearing: ${existingLocations.length}`)

  // Clear existing data
  await redis.del('locations')
  await redis.del('company_names')
  console.log('Cleared existing location data')

  let validCount = 0
  let invalidCount = 0
  const processedLocations = new Set()
  const errors = []
  const storedIds = new Set()

  // Use pipeline for better performance
  const pipeline = redis.pipeline()

  for (const setup of serviceSetups) {
    const { location, company, id: setupId } = setup

    if (!location?.id) {
      console.warn(`Setup ${setupId} missing location ID:`, setup)
      invalidCount++
      continue
    }

    const locationId = location.id.toString()

    if (processedLocations.has(locationId)) {
      console.log(`Skipping duplicate location ID: ${locationId} (setup ${setupId})`)
      continue
    }

    if (location?.latitude != null && location?.longitude != null) {
      try {
        pipeline.geoadd('locations', location.longitude, location.latitude, locationId)
        pipeline.hset('company_names', locationId, company || '')
        validCount++
        processedLocations.add(locationId)
        storedIds.add(locationId)
      } catch (err) {
        console.error(`Failed to queue location ${locationId} (setup ${setupId}):`, err)
        errors.push({
          setupId,
          locationId,
          error: err.message,
          location: { lat: location.latitude, lon: location.longitude },
        })
        invalidCount++
      }
    } else {
      console.warn(
        `Invalid coordinates for setup ${setupId}, location ${locationId}:`,
        `lat=${location?.latitude},`,
        `lon=${location?.longitude}`,
      )
      invalidCount++
    }
  }

  // Execute pipeline
  try {
    await pipeline.exec()
  } catch (error) {
    console.error('Pipeline execution failed:', error)
    throw error
  }

  const finalCount = await redis.zcard('locations')
  console.log('Location storage complete:')
  console.log(`- Previous location count: ${existingLocations.length}`)
  console.log(`- Valid locations queued: ${validCount}`)
  console.log(`- Invalid/skipped: ${invalidCount}`)
  console.log(`- Final Redis count: ${finalCount}`)

  if (finalCount < validCount) {
    console.error('Warning: Final count less than valid locations!')
    console.error('Missing locations:', {
      expected: Array.from(storedIds),
      actual: await redis.zrange('locations', 0, -1),
    })
  }

  if (errors.length) {
    console.error('Storage errors:', errors)
  }

  return {
    validCount,
    invalidCount,
    finalCount,
    errors,
    storedIds: Array.from(storedIds),
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
  // If key contains wildcard, clear all matching keys
  if (key.includes('*')) {
    const pattern = new RegExp(key.replace('*', '.*'))
    const keys = memoryCache.keys()
    for (const cacheKey of keys) {
      if (pattern.test(cacheKey)) {
        memoryCache.del(cacheKey)
      }
    }
  } else {
    memoryCache.del(key)
  }
}

function formatNumber(num, precision = 14) {
  return Number(num.toFixed(precision))
}

export async function calculateDistance(id1, id2, redis) {
  const distance = await getVerifiedDistance(redis, id1, id2)
  if (!distance) {
    console.error(`Location not found in Redis: ${!id1 ? id1 : id2}`)
    return null
  }

  // Get location info for the response
  const [geopos, companies] = await Promise.all([
    redis.geopos('locations', id1, id2),
    redis.hmget('company_names', id1, id2),
  ])

  if (!geopos?.[0] || !geopos?.[1]) {
    return null
  }

  const [lon1, lat1] = geopos[0]
  const [lon2, lat2] = geopos[1]
  const [company1, company2] = companies

  return {
    pair: {
      id: `${id1},${id2}`,
      distance: formatNumber(distance),
      points: [
        {
          id: id1,
          company: company1,
          location: {
            longitude: formatNumber(Number.parseFloat(lon1)),
            latitude: formatNumber(Number.parseFloat(lat1)),
          },
        },
        {
          id: id2,
          company: company2,
          location: {
            longitude: formatNumber(Number.parseFloat(lon2)),
            latitude: formatNumber(Number.parseFloat(lat2)),
          },
        },
      ],
    },
  }
}

export async function refreshMissingLocations(missingLocationIds) {
  const redis = getRedisClient()
  console.log(`Attempting to refresh ${missingLocationIds.length} missing locations...`)
  console.log('Missing Location IDs:', missingLocationIds)

  try {
    // Fetch setups by location ID
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
    const serviceSetupsUrl = `${baseUrl}/api/serviceSetups`
    console.log(`Fetching from: ${serviceSetupsUrl}?id=${missingLocationIds.join(',')}`)

    const response = await axios.get(serviceSetupsUrl, {
      params: { id: missingLocationIds.join(',') },
    })
    const services = response.data

    if (!Array.isArray(services) || services.length === 0) {
      console.error('No services found for missing locations')
      return {
        refreshedCount: 0,
        errors: [
          {
            error: 'No services found for location IDs',
            missingLocationIds,
          },
        ],
      }
    }

    console.log(`Found ${services.length} matching services for missing locations`)

    // Use pipeline for better performance
    const pipeline = redis.pipeline()
    let validCount = 0
    const errors = []
    const processedIds = new Set()

    for (const setup of services) {
      const { location, company } = setup

      if (!location?.id || location?.latitude == null || location?.longitude == null) {
        console.error(`Invalid location data for setup ${setup.id}:`, location)
        errors.push({ setupId: setup.id, locationId: location?.id, error: 'Invalid location data' })
        continue
      }

      const locationId = location.id.toString()
      if (processedIds.has(locationId)) {
        console.log(`Skipping duplicate location ID: ${locationId}`)
        continue
      }

      try {
        pipeline.geoadd('locations', location.longitude, location.latitude, locationId)
        pipeline.hset('company_names', locationId, company || '')
        validCount++
        processedIds.add(locationId)
      } catch (err) {
        console.error(`Error queueing location ${locationId}:`, err)
        errors.push({ setupId: setup.id, locationId, error: err.message })
      }
    }

    console.log('Executing Redis pipeline...')
    await pipeline.exec()

    const finalCount = await redis.zcard('locations')
    console.log('Refresh complete:')
    console.log(`- Locations processed: ${services.length}`)
    console.log(`- Valid locations added: ${validCount}`)
    console.log(`- Errors encountered: ${errors.length}`)
    console.log(`- Total locations in Redis: ${finalCount}`)

    // Verify the missing locations were actually added
    const refreshedLocations = await Promise.all(
      missingLocationIds.map(locationId => redis.geopos('locations', locationId)),
    )
    const stillMissingLocationIds = missingLocationIds.filter(
      (locationId, i) => !refreshedLocations[i]?.[0],
    )

    if (stillMissingLocationIds.length > 0) {
      console.error('Some locations still missing after refresh:', stillMissingLocationIds)
    }

    return {
      refreshedCount: validCount,
      errors,
      processedIds: Array.from(processedIds),
      stillMissingLocationIds,
    }
  } catch (error) {
    console.error('Error refreshing locations:', error)
    throw error
  }
}

export async function getLocationPairs(idPairs) {
  const redis = getRedisClient()
  console.log(`Processing ${idPairs.length} location pairs...`)

  // First verify all IDs exist
  const allLocationIds = new Set(idPairs.flatMap(pair => pair.split(',')))
  console.log(`Checking ${allLocationIds.size} unique locations...`)

  const locations = await Promise.all(
    Array.from(allLocationIds).map(locationId => redis.geopos('locations', locationId)),
  )
  const missingLocationIds = Array.from(allLocationIds).filter(
    (locationId, index) => !locations[index]?.[0],
  )

  if (missingLocationIds.length > 0) {
    console.log(`Found ${missingLocationIds.length} missing locations, attempting refresh...`)

    // Try refreshing missing locations
    const refreshResult = await refreshMissingLocations(missingLocationIds)

    // Check which locations are still missing
    const refreshedLocations = await Promise.all(
      missingLocationIds.map(locationId => redis.geopos('locations', locationId)),
    )
    const stillMissingLocationIds = missingLocationIds.filter(
      (locationId, index) => !refreshedLocations[index]?.[0],
    )

    if (stillMissingLocationIds.length > 0) {
      console.error('Locations still missing after refresh:', stillMissingLocationIds)
      return {
        error: 'missing_locations',
        missingLocationIds: stillMissingLocationIds,
        totalLocationsInRedis: await redis.zcard('locations'),
      }
    }
  }

  // Only recalculate pairs that contain refreshed locations
  const affectedPairs = idPairs.filter(pair => {
    const [locationId1, locationId2] = pair.split(',')
    return missingLocationIds.includes(locationId1) || missingLocationIds.includes(locationId2)
  })

  if (affectedPairs.length > 0) {
    console.log(`Recalculating ${affectedPairs.length} affected pairs...`)
  }

  // Process pairs in parallel, reusing cached results for unaffected pairs
  const results = await Promise.all(
    idPairs.map(async pair => {
      const [locationId1, locationId2] = pair.split(',')
      const cacheKey = `distance:${locationId1},${locationId2}`

      // Only recalculate if pair was affected by refresh
      if (affectedPairs.includes(pair)) {
        // console.log(`Calculating distance for refreshed pair: ${pair}`)
        const result = await calculateDistance(locationId1, locationId2, redis)
        if (result) setCachedData(cacheKey, result)
        return result
      }

      // Use cached result if available
      const cachedResult = await getCachedData(cacheKey)
      if (cachedResult) return cachedResult

      // Calculate if not in cache
      // console.log(`Calculating uncached distance for: ${pair}`)
      const result = await calculateDistance(locationId1, locationId2, redis)
      if (result) setCachedData(cacheKey, result)
      return result
    }),
  )

  return { results: results.filter(Boolean) }
}

export async function getLocations(forceRefresh = false) {
  const redis = getRedisClient()
  try {
    // Check if locations are already loaded
    const locationCount = await redis.zcard('locations')
    // console.log(`Current location count in Redis: ${locationCount}`)

    if (locationCount === 0 || forceRefresh) {
      console.log(forceRefresh ? 'Forcing Redis refresh...' : 'Loading locations into Redis...')

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

      // Verify all required locations are stored
      const storedLocations = await redis.zrange('locations', 0, -1)
      const missingLocations = services
        .filter(s => s.location?.id && !storedLocations.includes(s.location.id.toString()))
        .map(s => ({ setupId: s.id, locationId: s.location.id }))

      if (missingLocations.length > 0) {
        console.error('Missing locations after storage:', missingLocations)
        throw new Error(`Failed to store ${missingLocations.length} locations`)
      }

      return result.finalCount
    }

    return locationCount
  } catch (error) {
    console.error('Error in getLocations:', error)
    throw error
  }
}
