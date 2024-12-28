import { getRedisClient, deleteCachedData } from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    // Get Redis client
    const redis = getRedisClient()

    // Clear all distance-related keys from Redis
    const distanceKeys = await redis.keys('distance:*')
    const matrixKeys = await redis.keys('distanceMatrix:*')
    const locationKeys = await redis.keys('location:*')

    console.log('Found keys to clear:', {
      distances: distanceKeys.length,
      matrices: matrixKeys.length,
      locations: locationKeys.length,
    })

    // Delete each key from Redis
    const deletePromises = []
    if (distanceKeys.length > 0) {
      deletePromises.push(redis.del(...distanceKeys))
    }
    if (matrixKeys.length > 0) {
      deletePromises.push(redis.del(...matrixKeys))
    }
    if (locationKeys.length > 0) {
      deletePromises.push(redis.del(...locationKeys))
    }

    // Wait for all Redis operations to complete
    await Promise.all(deletePromises)

    // Clear all distance-related keys from memory cache
    for (const key of [...distanceKeys, ...matrixKeys, ...locationKeys]) {
      deleteCachedData(key)
    }

    // Verify keys were deleted
    const remainingKeys = await redis.keys('distance*')
    const remainingLocations = await redis.keys('location:*')

    if (remainingKeys.length > 0 || remainingLocations.length > 0) {
      console.warn('Some keys remain after deletion:', {
        distances: remainingKeys,
        locations: remainingLocations,
      })
    }

    // Force a refresh of the locations data
    await redis.del('locations')
    await redis.del('company_names')

    return NextResponse.json({
      success: true,
      cleared: {
        distances: distanceKeys.length,
        matrices: matrixKeys.length,
        locations: locationKeys.length,
      },
      remaining: {
        distances: remainingKeys.length,
        locations: remainingLocations.length,
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
