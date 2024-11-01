import { getRedisClient } from '@/app/utils/redis'
import { NextResponse } from 'next/server'

const EARTH_RADIUS_MILES = 3958.8

function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180)
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const dLat = degreesToRadians(lat2 - lat1)
  const dLon = degreesToRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degreesToRadians(lat1)) *
      Math.cos(degreesToRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_MILES * c
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId')
  const toId = searchParams.get('toId')
  const pairs = JSON.parse(searchParams.get('pairs') || '[]')

  if (!fromId && !toId && !pairs.length) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 },
    )
  }

  try {
    const redis = getRedisClient()

    // Handle single pair distance query
    if (fromId && toId) {
      // Get location details first for better error reporting
      const [fromDetails, toDetails] = await Promise.all([
        redis.hgetall(`location:${fromId}`),
        redis.hgetall(`location:${toId}`),
      ])

      // Try Redis geodist first (fastest)
      const redisDistance = await redis.geodist(
        'locations',
        fromId.toString(),
        toId.toString(),
        'mi',
      )

      if (redisDistance !== null) {
        return NextResponse.json({
          distance: Number.parseFloat(redisDistance),
          source: 'redis',
        })
      }

      // If Redis geodist fails, try getting coordinates from locations set
      const [fromLoc, toLoc] = await Promise.all([
        redis.geopos('locations', fromId),
        redis.geopos('locations', toId),
      ])

      if (!fromLoc?.[0] || !toLoc?.[0]) {
        console.error(
          `Location data missing in Redis:
          From Location:
            ID: ${fromId}
            Company: ${fromDetails?.companyName || 'Unknown'}
            Address: ${fromDetails?.address || 'Unknown'}
            Coordinates: ${fromLoc?.[0] ? 'Found' : 'Missing'}
          To Location:
            ID: ${toId}
            Company: ${toDetails?.companyName || 'Unknown'}
            Address: ${toDetails?.address || 'Unknown'}
            Coordinates: ${toLoc?.[0] ? 'Found' : 'Missing'}`,
        )
        return NextResponse.json(
          { error: 'Location data not found' },
          { status: 404 },
        )
      }

      const distance = calculateDistance(
        fromLoc[0][1], // lat
        fromLoc[0][0], // lon
        toLoc[0][1], // lat
        toLoc[0][0], // lon
      )

      return NextResponse.json({
        distance,
        source: 'calculated',
      })
    }

    // Handle multiple pairs
    if (pairs.length) {
      const pipeline = redis.pipeline()

      // First get all locations to validate they exist
      const allIds = [...new Set(pairs.flat())]
      const locationPromises = allIds.map(id => redis.geopos('locations', id))
      const locations = await Promise.all(locationPromises)

      // Check if any locations are missing
      const missingIds = allIds.filter((id, index) => !locations[index]?.[0])
      if (missingIds.length > 0) {
        console.error(`Missing locations for IDs: ${missingIds.join(', ')}`)
        return NextResponse.json(
          {
            error: `Location data not found for IDs: ${missingIds.join(', ')}`,
          },
          { status: 404 },
        )
      }

      // All locations exist, proceed with distance calculations
      for (const [id1, id2] of pairs) {
        pipeline.geodist('locations', id1, id2, 'mi')
      }

      const results = await pipeline.exec()
      const distances = results.map(([err, result]) =>
        err ? null : Number.parseFloat(result),
      )

      return NextResponse.json({
        distances,
        source: 'redis',
      })
    }
  } catch (error) {
    console.error('Error calculating distances:', error)
    return NextResponse.json(
      { error: 'Failed to calculate distances', details: error.message },
      { status: 500 },
    )
  }
}
