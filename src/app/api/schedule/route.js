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
  console.log('Schedule API called with params:', params)

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

    console.log('Services API response:', {
      count: response.data.length,
      sample: response.data[0],
    })

    const services = response.data.filter(
      service => service.time.range[0] !== null && service.time.range[1] !== null,
    )

    console.log('Filtered services:', {
      count: services.length,
      sample: services[0],
    })

    if (!services.length) {
      console.log('No services found')
      return NextResponse.json({
        scheduledServices: [],
        unassignedServices: [],
      })
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      const result = {
        scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
        unassignedServices: [],
      }
      console.log('Returning unscheduled services:', {
        count: result.scheduledServices.length,
        sample: result.scheduledServices[0],
      })
      return NextResponse.json(result)
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

    console.log('Worker result:', {
      scheduledCount: result.scheduledServices?.length,
      unassignedCount: result.unassignedServices?.length,
      sample: result.scheduledServices?.[0],
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
      },
      { status: 500 },
    )
  }
}
