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
  const idPairs = searchParams.getAll('id')

  try {
    await getLocations()

    if (idPairs.length > 0) {
      const results = await Promise.all(
        idPairs.map(async pair => {
          const [id1, id2] = pair.split(',')
          const cacheKey = `distance:${id1},${id2}`
          const cachedResult = getCachedData(cacheKey)

          if (cachedResult) {
            return cachedResult
          }

          const [geopos1, company1] = await Promise.all([
            redis.geopos('locations', id1),
            redis.hget('company_names', id1),
          ])

          if (!geopos1[0]) {
            return { error: `ID ${id1} not found` }
          }

          const [lon1, lat1] = geopos1[0]

          if (!id2) {
            const nearestLocations = await redis.georadius(
              'locations',
              lon1,
              lat1,
              100,
              'mi',
              'WITHDIST',
              'COUNT',
              6,
              'ASC',
            )

            const nearestLocationDetails = await Promise.all(
              nearestLocations.slice(1).map(async ([id, distance]) => {
                const [geopos, company] = await Promise.all([
                  redis.geopos('locations', id),
                  redis.hget('company_names', id),
                ])
                const [lon, lat] = geopos[0]
                return {
                  id,
                  distance: parseFloat(distance),
                  company,
                  location: {
                    longitude: parseFloat(lon),
                    latitude: parseFloat(lat),
                  },
                }
              }),
            )

            const result = {
              from: {
                id: id1,
                company: company1,
                location: {
                  longitude: parseFloat(lon1),
                  latitude: parseFloat(lat1),
                },
              },
              distances: nearestLocationDetails,
            }
            setCachedData(cacheKey, result)
            return result
          }

          const [geopos2, company2, distance] = await Promise.all([
            redis.geopos('locations', id2),
            redis.hget('company_names', id2),
            redis.geodist('locations', id1, id2, 'mi'),
          ])

          if (!geopos2[0]) {
            return { error: `ID ${id2} not found` }
          }

          const [lon2, lat2] = geopos2[0]

          const result = {
            from: {
              id: id1,
              company: company1,
              location: {
                longitude: parseFloat(lon1),
                latitude: parseFloat(lat1),
              },
            },
            distance: [
              {
                id: id2,
                distance: parseFloat(distance),
                company: company2,
                location: {
                  longitude: parseFloat(lon2),
                  latitude: parseFloat(lat2),
                },
              },
            ],
          }
          setCachedData(cacheKey, result)
          return result
        }),
      )

      return NextResponse.json(results)
    }

    return NextResponse.json(
      { error: 'Invalid query parameters' },
      { status: 400 },
    )
  } catch (error) {
    console.error('Error processing distance request:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
