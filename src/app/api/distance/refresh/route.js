import { getRedisClient, deleteCachedData } from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

const BATCH_SIZE = 1000

async function deleteKeysBatch(redis, keys) {
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE)
    if (batch.length > 0) {
      await redis.del(...batch)
    }
  }
}

export async function POST() {
  try {
    // Get Redis client
    const redis = getRedisClient()

    // Clear all distance-related keys from Redis
    const distanceKeys = await redis.keys('distance:*')
    const matrixKeys = await redis.keys('distanceMatrix:*')

    // Delete keys in batches
    await deleteKeysBatch(redis, distanceKeys)
    await deleteKeysBatch(redis, matrixKeys)

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
