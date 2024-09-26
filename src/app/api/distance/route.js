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

  // Add this logging to check what's actually being stored
  const allLocations = await redis.zrange('locations', 0, -1)
  const companyNames = await redis.hgetall('company_names')
  console.log('Sample of stored data:')
  for (let i = 0; i < Math.min(5, allLocations.length); i++) {
    const id = allLocations[i]
    const company = companyNames[id]
    console.log(`ID: ${id}, Company: ${company}`)
  }
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
  console.log(`Called with ${searchParams}`)
  const refresh = searchParams.has('refresh')
  const ids = searchParams.get('id')?.split(',') || []
  const radius = parseFloat(searchParams.get('radius')) || 25
  const limit = parseInt(searchParams.get('limit')) || 10

  try {
    let locationCount = await redis.zcard('locations')

    if (locationCount === 0 || refresh) {
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

    if (refresh || ids.length === 0) {
      const allLocations = await redis.zrange('locations', 0, -1)
      const companyNames = await redis.hgetall('company_names')
      const geoposResults = await redis.geopos('locations', ...allLocations)

      const locationData = allLocations.map((id, index) => {
        const [longitude, latitude] = geoposResults[index] || [null, null]
        return {
          id,
          company: companyNames[id],
          location: {
            longitude: longitude ? parseFloat(longitude) : null,
            latitude: latitude ? parseFloat(latitude) : null,
          },
        }
      })

      return NextResponse.json({ locations: locationData })
    }

    if (ids.length === 1 || ids.length === 2) {
      const id1 = ids[0]
      const [geopos1, company1] = await Promise.all([
        redis.geopos('locations', id1),
        redis.hget('company_names', id1),
      ])

      if (!geopos1[0]) {
        return NextResponse.json(
          { error: 'Specified ID not found' },
          { status: 404 },
        )
      }

      const [lon1, lat1] = geopos1[0]

      let results
      if (ids.length === 2) {
        const id2 = ids[1]
        const [geopos2, company2, distance] = await Promise.all([
          redis.geopos('locations', id2),
          redis.hget('company_names', id2),
          redis.geodist('locations', id1, id2, 'mi'),
        ])

        if (!geopos2[0]) {
          return NextResponse.json(
            { error: 'Second ID not found' },
            { status: 404 },
          )
        }

        const [lon2, lat2] = geopos2[0]
        results = [
          {
            id: id2,
            distance: parseFloat(distance),
            company: company2,
            location: {
              longitude: parseFloat(lon2),
              latitude: parseFloat(lat2),
            },
          },
        ]
      } else {
        results = await redis.georadius(
          'locations',
          lon1,
          lat1,
          radius,
          'mi',
          'WITHDIST',
          'WITHCOORD',
          'ASC',
          'COUNT',
          limit + 1,
        )
        results = results.slice(1) // Remove the origin point

        results = await Promise.all(
          results.map(async ([otherId, distance, [lon2, lat2]]) => {
            const company = await redis.hget('company_names', otherId)
            return {
              id: otherId,
              distance: parseFloat(distance),
              company,
              location: {
                longitude: parseFloat(lon2),
                latitude: parseFloat(lat2),
              },
            }
          }),
        )
      }

      return NextResponse.json({
        from: {
          id: id1,
          company: company1,
          location: {
            longitude: parseFloat(lon1),
            latitude: parseFloat(lat1),
          },
        },
        distance: results,
      })
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
