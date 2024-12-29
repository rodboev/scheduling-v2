import { NextResponse } from 'next/server'
import { getCachedData, setCachedData } from '@/app/utils/locationCache'
import { createDistanceMatrix } from '@/app/utils/distance'
import { clusterServices } from './clustering'

export async function POST(request) {
  try {
    const { services } = await request.json()

    if (!Array.isArray(services) || services.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request: services must be a non-empty array' },
        { status: 400 },
      )
    }

    // Generate cache key based on service IDs
    const cacheKey = `clusters:${services.map(s => s.id).join(',')}`
    const cachedResult = getCachedData(cacheKey)
    if (cachedResult) {
      return NextResponse.json(cachedResult)
    }

    // Create distance matrix
    const distanceMatrix = await createDistanceMatrix(services)

    // Cluster services
    const result = await clusterServices(services, distanceMatrix)

    // Cache result
    setCachedData(cacheKey, result)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in cluster route:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
