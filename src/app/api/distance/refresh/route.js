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
    const deletePromises = []
    if (distanceKeys.length > 0) {
      deletePromises.push(redis.del(...distanceKeys))
    }
    if (matrixKeys.length > 0) {
      deletePromises.push(redis.del(...matrixKeys))
    }

    // Wait for all Redis operations to complete
    await Promise.all(deletePromises)

    // Clear all distance-related keys from memory cache
    for (const key of [...distanceKeys, ...matrixKeys]) {
      deleteCachedData(key)
    }

    // Verify keys were deleted
    const remainingKeys = await redis.keys('distance*')
    if (remainingKeys.length > 0) {
      console.warn('Some distance keys remain after deletion:', remainingKeys)
    }

    return NextResponse.json({
      success: true,
      cleared: {
        distances: distanceKeys.length,
        matrices: matrixKeys.length,
      },
      remaining: remainingKeys.length,
    })
  } catch (error) {
    console.error('Error refreshing distances:', error)
    return NextResponse.json(
      { error: 'Failed to refresh distances', details: error.message },
      { status: 500 },
    )
  }
}
