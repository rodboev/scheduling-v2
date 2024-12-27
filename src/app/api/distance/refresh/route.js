import { getRedisClient, deleteCachedData } from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    // Get Redis client
    const redis = getRedisClient()

    // Clear all distance-related keys from Redis
    const distanceKeys = await redis.keys('distance:*')
    const matrixKeys = await redis.keys('distanceMatrix:*')

    // Delete each key from Redis
    if (distanceKeys.length > 0) {
      await redis.del(...distanceKeys)
    }
    if (matrixKeys.length > 0) {
      await redis.del(...matrixKeys)
    }

    // Clear all distance-related keys from memory cache
    for (const key of [...distanceKeys, ...matrixKeys]) {
      deleteCachedData(key)
    }

    return NextResponse.json({
      success: true,
      cleared: {
        distances: distanceKeys.length,
        matrices: matrixKeys.length,
      },
    })
  } catch (error) {
    console.error('Error refreshing distances:', error)
    return NextResponse.json(
      { error: 'Failed to refresh distances', details: error.message },
      { status: 500 },
    )
  }
}
