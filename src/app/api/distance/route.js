import {
  getLocationPairs,
  calculateDistance,
  getRedisClient,
  getCachedData,
  setCachedData,
} from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId')
  const toId = searchParams.get('toId')
  const idPairs = Array.from(searchParams.entries())
    .filter(([key]) => key === 'id')
    .map(([_, value]) => decodeURIComponent(value))

  try {
    // Handle single distance request
    if (fromId && toId) {
      const cacheKey = `distance:${fromId},${toId}`
      const cachedResult = getCachedData(cacheKey)
      if (cachedResult) return NextResponse.json(cachedResult)

      const redis = getRedisClient()
      const result = await calculateDistance(fromId, toId, redis)
      setCachedData(cacheKey, result)
      return NextResponse.json(result)
    }

    // Handle multiple distance requests
    if (idPairs.length > 0) {
      console.log(`Processing ${idPairs.length} pairs in batch`)
      const response = await getLocationPairs(idPairs)

      if (response.error === 'missing_locations') {
        return NextResponse.json(
          {
            error: {
              message: 'Some locations not found',
              details: response.missingIds.map(
                id => `Location ID ${id} missing from Redis locations`,
              ),
              context: {
                missingLocationIds: response.missingIds,
                totalLocationsInRedis: response.totalLocationsInRedis,
              },
            },
          },
          { status: 400 },
        )
      }

      return NextResponse.json(response.results)
    }

    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  } catch (error) {
    console.error('Error processing distance request:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
