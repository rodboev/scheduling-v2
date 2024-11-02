import {
  getRedisClient,
  getLocations,
  getCachedData,
  setCachedData,
} from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'

const redis = getRedisClient()

const EARTH_RADIUS_MILES = 3958.8 // Earth's radius in miles

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

  if (!fromId || !toId) {
    return NextResponse.json(
      { error: 'Missing fromId or toId parameter' },
      { status: 400 },
    )
  }

  try {
    await getLocations()

    const cacheKey = `distance:${fromId},${toId}`
    const cachedResult = getCachedData(cacheKey)

    if (cachedResult) {
      return NextResponse.json(cachedResult)
    }

    const [geopos1, company1] = await Promise.all([
      redis.geopos('locations', fromId),
      redis.hget('company_names', fromId),
    ])

    if (!geopos1?.[0]) {
      return NextResponse.json(
        { error: `Location ${fromId} not found` },
        { status: 404 },
      )
    }

    const [lon1, lat1] = geopos1[0]

    const [geopos2, company2, distance] = await Promise.all([
      redis.geopos('locations', toId),
      redis.hget('company_names', toId),
      redis.geodist('locations', fromId, toId, 'mi'),
    ])

    if (!geopos2?.[0]) {
      return NextResponse.json(
        { error: `Location ${toId} not found` },
        { status: 404 },
      )
    }

    const [lon2, lat2] = geopos2[0]

    const result = {
      from: {
        id: fromId,
        company: company1,
        location: {
          longitude: Number.parseFloat(lon1),
          latitude: Number.parseFloat(lat1),
        },
      },
      to: {
        id: toId,
        company: company2,
        location: {
          longitude: Number.parseFloat(lon2),
          latitude: Number.parseFloat(lat2),
        },
      },
      distance: Number.parseFloat(distance),
    }

    setCachedData(cacheKey, result)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error processing distance request:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
