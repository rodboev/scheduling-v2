import { getRedisClient } from '@/app/utils/redis'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const ids = searchParams.get('ids')?.split(',')

  if (!ids) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  }

  try {
    const client = getRedisClient()
    const pipeline = client.pipeline()

    for (const id of ids) {
      pipeline.geopos('locations', id)
      pipeline.hget('company_names', id)
    }

    const results = await pipeline.exec()
    const locationInfo = ids.map((id, index) => {
      const [, pos] = results[index * 2]
      const [, company] = results[index * 2 + 1]
      return pos
        ? {
            id,
            company,
            location: {
              longitude: Number.parseFloat(pos[0]),
              latitude: Number.parseFloat(pos[1]),
            },
          }
        : null
    })

    return NextResponse.json(locationInfo)
  } catch (error) {
    console.error('Error fetching location info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch location info' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const serviceSetups = await request.json()
    const redis = getRedisClient()
    const pipeline = redis.pipeline()

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

    return NextResponse.json({ validCount, invalidCount })
  } catch (error) {
    console.error('Error storing locations:', error)
    return NextResponse.json(
      { error: 'Failed to store locations' },
      { status: 500 },
    )
  }
}
