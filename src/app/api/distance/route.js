import { readFromDiskCache, writeToDiskCache } from '@/app/utils/diskCache'
import Redis from 'ioredis'
import { NextResponse } from 'next/server'

const redis = new Redis() // Connects to localhost:6379 by default

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

async function generateAndStoreDistances(serviceSetups) {
  const pipeline = redis.pipeline()

  // Clear existing data
  pipeline.del('locations')
  pipeline.del('company_names')

  let validCount = 0
  let invalidCount = 0
  const processedLocations = new Set()

  for (const setup of serviceSetups) {
    const { location, company } = setup
    if (
      location &&
      typeof location.latitude === 'number' &&
      typeof location.longitude === 'number' &&
      !processedLocations.has(location.id)
    ) {
      pipeline.geoadd(
        'locations',
        location.longitude,
        location.latitude,
        location.id.toString(),
      )
      pipeline.hset('company_names', location.id.toString(), company)
      validCount++
      processedLocations.add(location.id)
    } else if (!processedLocations.has(location.id)) {
      console.warn(`Invalid location data for id ${location.id}. Skipping.`)
      invalidCount++
    }
  }

  await pipeline.exec()

  console.log(
    `Locations and company names stored in Redis. Valid: ${validCount}, Invalid: ${invalidCount}`,
  )
}

async function getOrGenerateDistances() {
  const locationCount = await redis.zcard('locations')

  if (locationCount === 0) {
    console.log('Regenerating distance data...')
    const serviceSetups = await readFromDiskCache({
      file: 'serviceSetups.json',
    })
    if (!serviceSetups) throw new Error('Unable to read service setups')
    await generateAndStoreDistances(serviceSetups)
    console.log('Distance data regenerated and saved')
  }

  return locationCount
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const idPairs = searchParams.getAll('id')

  try {
    let locationCount = await redis.zcard('locations')

    if (locationCount === 0) {
      console.log('Regenerating distance data...')
      const serviceSetups = await readFromDiskCache({
        file: 'serviceSetups.json',
      })
      if (!serviceSetups || !Array.isArray(serviceSetups)) {
        throw new Error('Unable to read service setups or invalid data format')
      }
      await generateAndStoreDistances(serviceSetups)
      locationCount = await redis.zcard('locations')
      console.log(
        `Distance data regenerated and saved. New count: ${locationCount}`,
      )
    }

    if (idPairs.length > 0) {
      const results = await Promise.all(
        idPairs.map(async pair => {
          const [id1, id2] = pair.split(',')
          const [geopos1, company1] = await Promise.all([
            redis.geopos('locations', id1),
            redis.hget('company_names', id1),
          ])

          if (!geopos1[0]) {
            return { error: `ID ${id1} not found` }
          }

          const [lon1, lat1] = geopos1[0]

          const [geopos2, company2, distance] = await Promise.all([
            redis.geopos('locations', id2),
            redis.hget('company_names', id2),
            redis.geodist('locations', id1, id2, 'mi'),
          ])

          if (!geopos2[0]) {
            return { error: `ID ${id2} not found` }
          }

          const [lon2, lat2] = geopos2[0]

          return {
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
