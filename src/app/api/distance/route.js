import { getRedisClient, getLocations, getCachedData, setCachedData } from '@/app/utils/redisClient'
import { NextResponse } from 'next/server'
import axios from 'axios'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

const redis = getRedisClient()

function formatNumber(num, precision = 14) {
  return Number(num.toFixed(precision))
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId')
  const toId = searchParams.get('toId')
  const idPairs = Array.from(searchParams.entries())
    .filter(([key]) => key === 'id')
    .map(([_, value]) => value)

  try {
    // First try without force refresh
    await getLocations()

    // Handle single distance request
    if (fromId && toId) {
      const cacheKey = `distance:${fromId},${toId}`
      const cachedResult = getCachedData(cacheKey)

      if (cachedResult) return NextResponse.json(cachedResult)

      const [geopos1, company1] = await Promise.all([
        redis.geopos('locations', fromId),
        redis.hget('company_names', fromId),
      ])

      if (!geopos1?.[0]) {
        console.error(`Location ${fromId} not found`)
        return NextResponse.json({ error: 'Invalid location pair' }, { status: 400 })
      }

      const [geopos2, company2, distance] = await Promise.all([
        redis.geopos('locations', toId),
        redis.hget('company_names', toId),
        redis.geodist('locations', fromId, toId, 'mi'),
      ])

      if (!geopos2?.[0]) {
        console.error(`Location ${toId} not found`)
        return NextResponse.json({ error: 'Invalid location pair' }, { status: 400 })
      }

      const [lon1, lat1] = geopos1[0]
      const [lon2, lat2] = geopos2[0]

      const result = {
        pair: {
          id: `${fromId},${toId}`,
          distance: formatNumber(Number.parseFloat(distance)),
          points: [
            {
              id: fromId,
              company: company1,
              location: {
                longitude: formatNumber(Number.parseFloat(lon1)),
                latitude: formatNumber(Number.parseFloat(lat1)),
              },
            },
            {
              id: toId,
              company: company2,
              location: {
                longitude: formatNumber(Number.parseFloat(lon2)),
                latitude: formatNumber(Number.parseFloat(lat2)),
              },
            },
          ],
        },
      }

      setCachedData(cacheKey, result)
      return NextResponse.json(result)
    }

    // Handle multiple distance requests
    if (idPairs.length > 0) {
      // First verify all IDs exist
      const allIds = new Set(idPairs.flatMap((pair) => pair.split(',')))
      const locations = await Promise.all(
        Array.from(allIds).map((id) => redis.geopos('locations', id)),
      )

      const missingIds = Array.from(allIds).filter((id, index) => !locations[index]?.[0])
      if (missingIds.length > 0) {
        // Try force refreshing Redis before giving up
        console.log('Missing locations, attempting Redis refresh...')
        await getLocations(true)
        
        // Check again after refresh
        const refreshedLocations = await Promise.all(
          Array.from(allIds).map((id) => redis.geopos('locations', id)),
        )
        const stillMissingIds = Array.from(allIds).filter((id, index) => !refreshedLocations[index]?.[0])

        if (stillMissingIds.length > 0) {
          // Now proceed with the existing error handling...
          try {
            // Get service setups to cross-reference IDs
            const serviceSetupsUrl = `${BASE_URL}/api/serviceSetups`
            console.log('Fetching service setups from:', serviceSetupsUrl)

            const response = await axios.get(serviceSetupsUrl)
            if (!response?.data) {
              throw new Error(`Invalid response from serviceSetups: ${JSON.stringify(response)}`)
            }

            const serviceSetups = response.data

            // Check each missing ID against serviceSetups
            const detailedErrors = stillMissingIds.map((id) => {
              const setup = serviceSetups.find((s) => s.location?.id?.toString() === id)
              if (!setup) {
                return `Location ID ${id} not found in serviceSetups database`
              } else {
                return `Location ID ${id} (from setup ${setup.id}) exists in serviceSetups but missing from Redis locations`
              }
            })

            console.error('Location lookup errors:', {
              missingIds: stillMissingIds,
              serviceSetupsUrl,
              redisLocationsCount: await redis.zcard('locations'),
              detailedErrors,
            })

            return NextResponse.json(
              {
                error: {
                  message: 'Some locations not found',
                  details: detailedErrors,
                  context: {
                    missingLocationIds: stillMissingIds,
                    totalLocationsInRedis: await redis.zcard('locations'),
                  },
                },
              },
              { status: 400 },
            )
          } catch (error) {
            console.error('Error checking missing locations:', {
              error: error.message,
              stack: error.stack,
              config: error.config,
              response: error.response?.data,
            })
        try {
          // Get service setups to cross-reference IDs
          const serviceSetupsUrl = `${BASE_URL}/api/serviceSetups`
          console.log('Fetching service setups from:', serviceSetupsUrl)

          const response = await axios.get(serviceSetupsUrl)
          if (!response?.data) {
            throw new Error(`Invalid response from serviceSetups: ${JSON.stringify(response)}`)
          }

          const serviceSetups = response.data

          // Check each missing ID against serviceSetups
          const detailedErrors = missingIds.map((id) => {
            const setup = serviceSetups.find((s) => s.location?.id?.toString() === id)
            if (!setup) {
              return `Location ID ${id} not found in serviceSetups database`
            } else {
              return `Location ID ${id} (from setup ${setup.id}) exists in serviceSetups but missing from Redis locations`
            }
          })

          console.error('Location lookup errors:', {
            missingIds,
            serviceSetupsUrl,
            redisLocationsCount: await redis.zcard('locations'),
            detailedErrors,
          })

          return NextResponse.json(
            {
              error: {
                message: 'Some locations not found',
                details: detailedErrors,
                context: {
                  missingLocationIds: missingIds,
                  totalLocationsInRedis: await redis.zcard('locations'),
                },
              },
            },
            { status: 400 },
          )
        } catch (error) {
          console.error('Error checking missing locations:', {
            error: error.message,
            stack: error.stack,
            config: error.config,
            response: error.response?.data,
          })

          return NextResponse.json(
            {
              error: {
                message: 'Error validating locations',
                details: `Failed to check locations: ${error.message}`,
                context: {
                  missingLocationIds: missingIds,
                  totalLocationsInRedis: await redis.zcard('locations'),
                },
              },
            },
            { status: 500 },
          )
        }
      }

      const results = await Promise.all(
        idPairs.map(async (pair) => {
          const [id1, id2] = pair.split(',')
          const cacheKey = `distance:${id1},${id2}`
          const cachedResult = await getCachedData(cacheKey)

          if (cachedResult) return cachedResult

          const [geopos1, company1] = await Promise.all([
            redis.geopos('locations', id1),
            redis.hget('company_names', id1),
          ])

          const [geopos2, company2, distance] = await Promise.all([
            redis.geopos('locations', id2),
            redis.hget('company_names', id2),
            redis.geodist('locations', id1, id2, 'mi'),
          ])

          const [lon1, lat1] = geopos1[0]
          const [lon2, lat2] = geopos2[0]

          const result = {
            pair: {
              id: `${id1},${id2}`,
              distance: formatNumber(Number.parseFloat(distance)),
              points: [
                {
                  id: id1,
                  company: company1,
                  location: {
                    longitude: formatNumber(Number.parseFloat(lon1)),
                    latitude: formatNumber(Number.parseFloat(lat1)),
                  },
                },
                {
                  id: id2,
                  company: company2,
                  location: {
                    longitude: formatNumber(Number.parseFloat(lon2)),
                    latitude: formatNumber(Number.parseFloat(lat2)),
                  },
                },
              ],
            },
          }

          setCachedData(cacheKey, result)
          return result
        }),
      )

      return NextResponse.json(results)
    }

    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 })
  } catch (error) {
    console.error('Error processing distance request:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
