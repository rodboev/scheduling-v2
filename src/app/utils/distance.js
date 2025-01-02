import { getLocations, getCachedData, setCachedData, getDistances } from './locationCache.js'

async function getDistanceBetweenLocations(fromId, toId) {
  const [distance] = await getDistances([[fromId, toId]])
  return distance
}

export async function createDistanceMatrix(services) {
  // Validate services
  if (!Array.isArray(services) || services.length === 0) {
    console.warn(
      `Invalid services array: expected non-empty array, got ${Array.isArray(services) ? 'empty array' : typeof services}`,
    )
    return []
  }

  const cacheKey = `distanceMatrix:${services.map(s => s.id).join(',')}`
  const cachedMatrix = getCachedData(cacheKey)

  if (cachedMatrix) {
    return cachedMatrix
  }

  await getLocations() // Ensure locations are loaded

  // Get all unique location IDs
  const locationIds = [...new Set(services.map(s => s.location?.id?.toString()).filter(Boolean))]

  // Get the full distance matrix at once
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
  const matrixResponse = await fetch(`${baseUrl}/api/distance-matrix?ids=${locationIds.join(',')}`)
  const distanceData = await matrixResponse.json()

  // Initialize matrix with zeros on diagonal
  const distanceMatrix = Array(services.length)
    .fill()
    .map((_, i) => Array(services.length).fill(0))

  // Fill matrix using the distance data
  for (let i = 0; i < services.length; i++) {
    for (let j = i + 1; j < services.length; j++) {
      const fromId = services[i].location?.id?.toString()
      const toId = services[j].location?.id?.toString()
      if (fromId && toId) {
        const key = `${fromId},${toId}`
        const distance = distanceData[key] || null
        if (distance !== null) {
          distanceMatrix[i][j] = distance
          distanceMatrix[j][i] = distance // Mirror the distance
        }
      }
    }
  }

  setCachedData(cacheKey, distanceMatrix)
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

  return getDistanceBetweenLocations(fromId, toId)
}
