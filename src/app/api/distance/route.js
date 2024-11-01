import { calculateDistance } from '@/app/utils/distance'
import { getRedisClient } from '@/app/utils/redis'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId')
  const toId = searchParams.get('toId')

  if (!fromId || !toId) {
    return NextResponse.json(
      { error: 'Missing fromId or toId parameter' },
      { status: 400 },
    )
  }

  const redis = getRedisClient()
  const cacheKey = `distance:${fromId}:${toId}`
  const reverseCacheKey = `distance:${toId}:${fromId}`

  // Check cache first
  try {
    const cachedDistance =
      (await redis.get(cacheKey)) || (await redis.get(reverseCacheKey))
    if (cachedDistance) {
      return NextResponse.json({ distance: parseFloat(cachedDistance) })
    }

    // If not in cache, calculate and store
    const fromLocation = await redis.hgetall(`location:${fromId}`)
    const toLocation = await redis.hgetall(`location:${toId}`)

    if (!fromLocation || !toLocation) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const distance = calculateDistance(
      parseFloat(fromLocation.latitude),
      parseFloat(fromLocation.longitude),
      parseFloat(toLocation.latitude),
      parseFloat(toLocation.longitude),
    )

    // Cache the result
    await redis.set(cacheKey, distance)

    return NextResponse.json({ distance })
  } catch (error) {
    console.error('Error fetching distance:', error)
    return NextResponse.json(
      { error: 'Failed to get distance' },
      { status: 500 },
    )
  }
}
