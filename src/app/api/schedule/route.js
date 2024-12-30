import { NextResponse } from 'next/server'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import axios from 'axios'
import { createDistanceMatrix } from '@/app/utils/distance'

// Cache for service data with multiple days
const serviceCache = new Map()

// Helper to get cache key
function getCacheKey(start, end) {
  const startDate = new Date(start).toISOString().split('T')[0]
  const endDate = new Date(end).toISOString().split('T')[0]
  return `${startDate}_${endDate}`
}

export async function GET(request) {
  const params = Object.fromEntries(request.nextUrl.searchParams)

  try {
    const cacheKey = getCacheKey(params.start, params.end)
    const cachedData = serviceCache.get(cacheKey)

    // Check if we have valid cached data
    if (
      cachedData?.data &&
      Date.now() - cachedData.timestamp < 300000 // Cache for 5 minutes
    ) {
      console.log('Using cached services data for', cacheKey)
      return NextResponse.json(cachedData.data)
    }

    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: params.start,
        end: params.end,
      },
    })

    const services = response.data.filter(
      service => service.time.range[0] !== null && service.time.range[1] !== null,
    )

    if (!services.length) {
      return NextResponse.json({
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: 0,
          connectedPointsCount: 0,
          outlierCount: 0,
          totalClusters: 0,
          clusterSizes: [],
          clusterDistribution: [],
        },
      })
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      return NextResponse.json({
        scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: 0,
          connectedPointsCount: 0,
          outlierCount: services.length,
          totalClusters: 0,
          clusterSizes: [],
          clusterDistribution: [],
        },
      })
    }

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timed out'))
      }, 30000)

      worker.on('message', result => {
        clearTimeout(timeout)
        worker.terminate()
        resolve(result)
      })

      worker.on('error', error => {
        clearTimeout(timeout)
        worker.terminate()
        reject(error)
      })

      worker.postMessage({ services, distanceMatrix })
    })

    // Update cache for this day
    serviceCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    })

    // Clean up old cache entries
    const now = Date.now()
    for (const [key, value] of serviceCache.entries()) {
      if (now - value.timestamp > 300000) {
        // 5 minutes
        serviceCache.delete(key)
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Scheduling API error:', error)
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error.message,
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: 0,
          connectedPointsCount: 0,
          outlierCount: 0,
          totalClusters: 0,
          clusterSizes: [],
          clusterDistribution: [],
        },
      },
      { status: 500 },
    )
  }
}
