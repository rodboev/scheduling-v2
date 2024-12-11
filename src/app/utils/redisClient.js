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

export async function getLocations(forceRefresh = false) {
  const redis = getRedisClient()
  try {
    // Check if locations are already loaded
    const locationCount = await redis.zcard('locations')
    console.log(`Current location count in Redis: ${locationCount}`)

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
        .filter((s) => s.location?.id && !storedLocations.includes(s.location.id.toString()))
        .map((s) => ({ setupId: s.id, locationId: s.location.id }))

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

export async function refreshMissingLocations(missingIds) {
  const redis = getRedisClient()
  console.log(`Refreshing ${missingIds.length} missing locations...`)

  try {
    // Fetch only the missing locations from serviceSetups
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL}/api/serviceSetups`, {
      params: { id: missingIds.join(',') },
    })
    const services = response.data

    if (!Array.isArray(services)) {
      throw new Error(`Invalid services data for missing locations: ${typeof services}`)
    }

    // Use pipeline for better performance
    const pipeline = redis.pipeline()
    let validCount = 0
    const errors = []

    for (const setup of services) {
      const { location, company, id: setupId } = setup
      if (!location?.id || location?.latitude == null || location?.longitude == null) {
        errors.push({ setupId, locationId: location?.id, error: 'Invalid location data' })
        continue
      }

      try {
        pipeline.geoadd('locations', location.longitude, location.latitude, location.id.toString())
        pipeline.hset('company_names', location.id.toString(), company || '')
        validCount++
      } catch (err) {
        errors.push({ setupId, locationId: location.id, error: err.message })
      }
    }

    await pipeline.exec()
    console.log(`Successfully refreshed ${validCount}/${missingIds.length} locations`)

    if (errors.length) {
      console.error('Refresh errors:', errors)
    }

    return {
      refreshedCount: validCount,
      errors,
    }
  } catch (error) {
    console.error('Error refreshing locations:', error)
    throw error
  }
}

export async function calculateDistance(id1, id2, redis) {
  const [geopos1, company1] = await Promise.all([
    redis.geopos('locations', id1),
    redis.hget('company_names', id1),
  ])

  const [geopos2, company2, distance] = await Promise.all([
    redis.geopos('locations', id2),
    redis.hget('company_names', id2),
    redis.geodist('locations', id1, id2, 'mi'),
  ])

  const [lon1, lat1] = geopos1[0]
  const [lon2, lat2] = geopos2[0]

  return {
    pair: {
      id: `${id1},${id2}`,
      distance: formatNumber(Number.parseFloat(distance)),
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

export async function getLocationPairs(idPairs) {
  const redis = getRedisClient()

  // First verify all IDs exist
  const allIds = new Set(idPairs.flatMap((pair) => pair.split(',')))
  const locations = await Promise.all(Array.from(allIds).map((id) => redis.geopos('locations', id)))

  const missingIds = Array.from(allIds).filter((id, index) => !locations[index]?.[0])

  if (missingIds.length > 0) {
    // Try refreshing missing locations
    const refreshResult = await refreshMissingLocations(missingIds)

    // Check which locations are still missing
    const refreshedLocations = await Promise.all(
      missingIds.map((id) => redis.geopos('locations', id)),
    )
    const stillMissingIds = missingIds.filter((id, index) => !refreshedLocations[index]?.[0])

    if (stillMissingIds.length > 0) {
      return {
        error: 'missing_locations',
        missingIds: stillMissingIds,
        totalLocationsInRedis: await redis.zcard('locations'),
      }
    }
  }

  // Only recalculate pairs that contain refreshed locations
  const affectedPairs = idPairs.filter((pair) => {
    const [id1, id2] = pair.split(',')
    return missingIds.includes(id1) || missingIds.includes(id2)
  })

  // Process pairs in parallel, reusing cached results for unaffected pairs
  const results = await Promise.all(
    idPairs.map(async (pair) => {
      const [id1, id2] = pair.split(',')
      const cacheKey = `distance:${id1},${id2}`

      // Only recalculate if pair was affected by refresh
      if (affectedPairs.includes(pair)) {
        const result = await calculateDistance(id1, id2, redis)
        setCachedData(cacheKey, result)
        return result
      }

      // Use cached result if available
      const cachedResult = await getCachedData(cacheKey)
      if (cachedResult) return cachedResult

      // Calculate if not in cache
      const result = await calculateDistance(id1, id2, redis)
      setCachedData(cacheKey, result)
      return result
    }),
  )

  return { results }
}
