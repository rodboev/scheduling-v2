import {
  getLocationPairs,
  calculateDistance,
  getRedisClient,
  getCachedData,
  setCachedData,
} from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

const BATCH_SIZE = 100 // Process 100 pairs at a time

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId')
  const toId = searchParams.get('toId')
  const idPairs = Array.from(searchParams.entries())
    .filter(([key]) => key === 'id')
    .map(([_, value]) => value)

  try {
    // Handle single distance request
    if (fromId && toId) {
      const cacheKey = `distance:${fromId},${toId}`
      const cachedResult = getCachedData(cacheKey)
      if (cachedResult) return NextResponse.json(cachedResult)

      const redis = getRedisClient()
      const result = await calculateDistance(fromId, toId, redis)
      if (result) setCachedData(cacheKey, result)
      return NextResponse.json(result)
    }

    // Handle multiple distance requests
    if (idPairs.length > 0) {
      // Process in batches to avoid overwhelming Redis
      const results = []
      for (let i = 0; i < idPairs.length; i += BATCH_SIZE) {
        const batchPairs = idPairs.slice(i, i + BATCH_SIZE)
        const batchResponse = await getLocationPairs(batchPairs)

        if (batchResponse.error === 'missing_locations') {
          return NextResponse.json(
            {
              error: {
                message: 'Some locations not found',
                details: batchResponse.missingIds.map(
                  id => `Location ID ${id} missing from Redis locations`,
                ),
                context: {
                  missingLocationIds: batchResponse.missingIds,
                  totalLocationsInRedis: batchResponse.totalLocationsInRedis,
                },
              },
            },
            { status: 400 },
          )
        }

        results.push(...batchResponse.results)
      }

      return NextResponse.json(results)
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
