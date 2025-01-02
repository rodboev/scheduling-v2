import fs from 'fs'
import path from 'path'
import { calculateHaversineDistance } from '../map/utils/distance.js'
import { HARD_MAX_RADIUS_MILES } from './constants.js'

// In-memory cache
const locationCache = new Map()
const companyCache = new Map()
const CACHE_FILE = path.join(process.cwd(), 'data', 'location-cache.json')

// Memory cache for non-location data (like distance matrices)
const memoryCache = new Map()
const missingLocationsCache = new Set()

// Special cache for the full distance matrix
const distanceMatrixCache = {
  matrix: null,
  locationIds: new Set(),
  lastUpdated: null,
  TTL: 5 * 60 * 1000, // 5 minutes in milliseconds
}

// Ensure data directory exists
if (!fs.existsSync(path.join(process.cwd(), 'data'))) {
  fs.mkdirSync(path.join(process.cwd(), 'data'))
}

// Load cache from file on startup
try {
  if (fs.existsSync(CACHE_FILE)) {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    for (const [id, location] of Object.entries(data.locations)) {
      locationCache.set(id, location)
    }
    for (const [id, company] of Object.entries(data.companies)) {
      companyCache.set(id, company)
    }
    console.log(`Loaded ${locationCache.size} locations from cache file`)
  }
} catch (error) {
  console.error('Error loading cache file:', error)
}

// Save cache to file
function saveCache() {
  try {
    const data = {
      locations: Object.fromEntries(locationCache),
      companies: Object.fromEntries(companyCache),
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2))
  } catch (error) {
    console.error('Error saving cache file:', error)
  }
}

// Clear all data
export function clearLocations() {
  locationCache.clear()
  companyCache.clear()
  missingLocationsCache.clear()
  saveCache()
}

// Store locations
export async function storeLocations(serviceSetups) {
  console.log('Starting location storage process...')
  console.log(`Total service setups to process: ${serviceSetups.length}`)

  clearLocations()

  let validCount = 0
  let invalidCount = 0
  const processedLocations = new Set()
  const errors = []
  const storedIds = new Set()

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
        locationCache.set(locationId, [location.longitude, location.latitude])
        companyCache.set(locationId, company || '')
        validCount++
        processedLocations.add(locationId)
        storedIds.add(locationId)
      } catch (err) {
        console.error(`Failed to store location ${locationId} (setup ${setupId}):`, err)
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

  // Save to file
  saveCache()

  console.log('Location storage complete:')
  console.log(`- Valid locations stored: ${validCount}`)
  console.log(`- Invalid/skipped: ${invalidCount}`)
  console.log(`- Final count: ${locationCache.size}`)

  if (errors.length) {
    console.error('Storage errors:', errors)
  }

  return {
    validCount,
    invalidCount,
    finalCount: locationCache.size,
    errors,
    storedIds: Array.from(storedIds),
  }
}

// Get location info
export async function getLocationInfo(ids) {
  const missingIds = []
  const results = ids.map(id => {
    const pos = locationCache.get(id.toString())
    const company = companyCache.get(id.toString())

    if (!pos) {
      missingIds.push(id)
      return null
    }

    return {
      id,
      company,
      location: {
        longitude: Number(pos[0]),
        latitude: Number(pos[1]),
      },
    }
  })

  if (missingIds.length > 0) {
    // Only log new missing locations
    const newMissingIds = missingIds.filter(id => !missingLocationsCache.has(id))
    if (newMissingIds.length > 0) {
      console.error(`Locations not found: ${newMissingIds.join(', ')}`)
      newMissingIds.forEach(id => missingLocationsCache.add(id))
    }
  }

  return results
}

// Calculate distance between two points
export async function calculateDistance(id1, id2) {
  const pos1 = locationCache.get(id1.toString())
  const pos2 = locationCache.get(id2.toString())

  if (!pos1 || !pos2) {
    // Only log new missing locations
    const missingIds = []
    if (!pos1 && !missingLocationsCache.has(id1)) {
      missingIds.push(id1)
      missingLocationsCache.add(id1)
    }
    if (!pos2 && !missingLocationsCache.has(id2)) {
      missingIds.push(id2)
      missingLocationsCache.add(id2)
    }
    if (missingIds.length > 0) {
      console.error(`Locations not found: ${missingIds.join(', ')}`)
    }
    return null
  }

  const distance = calculateHaversineDistance(
    Number(pos1[1]),
    Number(pos1[0]),
    Number(pos2[1]),
    Number(pos2[0]),
  )

  // Always validate against HARD_MAX_RADIUS_MILES
  if (distance > HARD_MAX_RADIUS_MILES) {
    return null
  }

  return {
    pair: {
      id: `${id1},${id2}`,
      distance,
      points: [
        {
          id: id1,
          company: companyCache.get(id1.toString()),
          location: {
            longitude: Number(pos1[0]),
            latitude: Number(pos1[1]),
          },
        },
        {
          id: id2,
          company: companyCache.get(id2.toString()),
          location: {
            longitude: Number(pos2[0]),
            latitude: Number(pos2[1]),
          },
        },
      ],
    },
  }
}

// Get distances for multiple pairs
export async function getDistances(pairs) {
  return Promise.all(
    pairs.map(async ([id1, id2]) => {
      const result = await calculateDistance(id1, id2)
      return result?.pair.distance || null
    }),
  )
}

// Get location pairs
export async function getLocationPairs(idPairs) {
  console.log(`Processing ${idPairs.length} location pairs...`)

  // First verify all IDs exist
  const allLocationIds = new Set(idPairs.flatMap(pair => pair.split(',')))
  console.log(`Checking ${allLocationIds.size} unique locations...`)

  const missingLocationIds = Array.from(allLocationIds).filter(id => !locationCache.has(id))

  if (missingLocationIds.length > 0) {
    console.error('Missing locations:', missingLocationIds)
    return {
      error: 'missing_locations',
      missingLocationIds,
      totalLocationsInCache: locationCache.size,
    }
  }

  // Process all pairs
  const results = await Promise.all(
    idPairs.map(async pair => {
      const [locationId1, locationId2] = pair.split(',')
      return calculateDistance(locationId1, locationId2)
    }),
  )

  return { results: results.filter(Boolean) }
}

// Check if locations are loaded
export async function getLocations(forceRefresh = false) {
  if (locationCache.size === 0 || forceRefresh) {
    console.log(forceRefresh ? 'Forcing refresh...' : 'Loading locations...')

    // Load service setups
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    console.log(`Fetching service setups from: ${baseUrl}/api/serviceSetups`)

    const response = await fetch(`${baseUrl}/api/serviceSetups`)
    const services = await response.json()

    if (!Array.isArray(services)) {
      throw new Error(`Invalid services data: ${typeof services}`)
    }

    console.log(`Loaded ${services.length} services for location data`)

    const result = await storeLocations(services)

    if (result.finalCount === 0) {
      throw new Error('Failed to store any locations')
    }

    return result.finalCount
  }

  return locationCache.size
}

// Get cached data
export function getCachedData(key) {
  return memoryCache.get(key)
}

// Set cached data with TTL
export function setCachedData(key, data, ttl = 300) {
  memoryCache.set(key, data)

  // Set up expiration
  setTimeout(() => {
    if (memoryCache.get(key) === data) {
      memoryCache.delete(key)
    }
  }, ttl * 1000)
}

// Delete cached data
export function deleteCachedData(key) {
  console.log('Clearing cache for key pattern:', key)
  let deletedCount = 0

  // If key contains wildcard, clear all matching keys
  if (key.includes('*')) {
    const pattern = new RegExp(key.replace('*', '.*'))
    for (const cacheKey of memoryCache.keys()) {
      if (pattern.test(cacheKey)) {
        memoryCache.delete(cacheKey)
        deletedCount++
      }
    }
  } else {
    memoryCache.delete(key)
    deletedCount = 1
  }

  console.log(`Cleared ${deletedCount} cache entries`)

  // Also clear location cache if it's a distance-related key
  if (key.includes('distance')) {
    console.log('Also clearing location cache')
    locationCache.clear()
  }
}

// Function to get or create the full distance matrix
export async function getFullDistanceMatrix(newLocationIds = []) {
  const now = Date.now()

  // If matrix exists and isn't expired
  if (
    distanceMatrixCache.matrix &&
    distanceMatrixCache.lastUpdated &&
    now - distanceMatrixCache.lastUpdated < distanceMatrixCache.TTL
  ) {
    // Check if we need to add new locations
    const newIds = newLocationIds.filter(id => !distanceMatrixCache.locationIds.has(id))
    if (newIds.length === 0) {
      return distanceMatrixCache.matrix
    }

    // Add new locations to existing matrix
    for (const id1 of newIds) {
      for (const id2 of [...distanceMatrixCache.locationIds, ...newIds]) {
        if (id1 === id2) continue
        const result = await calculateDistance(id1, id2)
        if (result?.pair) {
          const key = `${id1},${id2}`
          distanceMatrixCache.matrix[key] = result.pair.distance
          distanceMatrixCache.matrix[`${id2},${id1}`] = result.pair.distance
        }
      }
      distanceMatrixCache.locationIds.add(id1)
    }
    distanceMatrixCache.lastUpdated = now
    return distanceMatrixCache.matrix
  }

  // Create new matrix
  const matrix = {}
  const allIds = [...new Set([...distanceMatrixCache.locationIds, ...newLocationIds])]

  for (let i = 0; i < allIds.length; i++) {
    for (let j = i + 1; j < allIds.length; j++) {
      const id1 = allIds[i]
      const id2 = allIds[j]
      const result = await calculateDistance(id1, id2)
      if (result?.pair) {
        const key = `${id1},${id2}`
        matrix[key] = result.pair.distance
        matrix[`${id2},${id1}`] = result.pair.distance
      }
    }
  }

  // Update cache
  distanceMatrixCache.matrix = matrix
  distanceMatrixCache.locationIds = new Set(allIds)
  distanceMatrixCache.lastUpdated = now

  return matrix
}

// Function to get distance between two locations from the matrix
export async function getMatrixDistance(id1, id2) {
  const matrix = await getFullDistanceMatrix([id1, id2])
  const key = `${id1},${id2}`
  return matrix[key]
}

// Clear matrix cache
export function clearDistanceMatrix() {
  distanceMatrixCache.matrix = null
  distanceMatrixCache.locationIds.clear()
  distanceMatrixCache.lastUpdated = null
}
