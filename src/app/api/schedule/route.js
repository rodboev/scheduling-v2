import { NextResponse } from 'next/server'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import axios from 'axios'
import { createDistanceMatrix } from '@/app/utils/distance'
import { startOfDay, endOfDay, dayjsInstance } from '@/app/utils/dayjs'
import { getFullDistanceMatrix } from '@/app/utils/locationCache'

const MAX_DAYS_PER_REQUEST = 2 // Process 2 days at a time

export async function GET(request) {
  const params = Object.fromEntries(request.nextUrl.searchParams)
  console.log('Schedule API called with params:', params)

  try {
    // Use the exact dates from the request
    const start = dayjsInstance(params.start)
    const end = dayjsInstance(params.end)

    console.log('Date range:', {
      requestedStart: params.start,
      requestedEnd: params.end,
      normalizedStart: start.format(),
      normalizedEnd: end.format(),
    })

    // Calculate number of days in request
    const totalDays = end.diff(start, 'day')
    console.log('Total days requested:', totalDays)

    // If request is within limit, process normally
    if (totalDays <= MAX_DAYS_PER_REQUEST) {
      return await processDateRange(start, end)
    }

    // For larger ranges, process in chunks and combine results
    console.log('Processing large date range in chunks...')
    let currentStart = start
    let allScheduledServices = []
    let totalConnectedPoints = 0
    let totalClusters = 0
    const startTime = performance.now()

    while (currentStart.isBefore(end)) {
      const chunkEnd = dayjsInstance.min(currentStart.add(MAX_DAYS_PER_REQUEST, 'day'), end)

      console.log(`Processing chunk: ${currentStart.format()} to ${chunkEnd.format()}`)
      const chunkResult = await processDateRange(currentStart, chunkEnd)
      const chunkData = await chunkResult.json()

      if (chunkData.scheduledServices) {
        allScheduledServices = allScheduledServices.concat(chunkData.scheduledServices)
        totalConnectedPoints += chunkData.clusteringInfo.connectedPointsCount
        totalClusters += chunkData.clusteringInfo.totalClusters
      }

      currentStart = chunkEnd
    }

    // Combine results
    const finalResult = {
      scheduledServices: allScheduledServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Math.round(performance.now() - startTime),
        connectedPointsCount: totalConnectedPoints,
        totalClusters: totalClusters,
        clusterSizes: allScheduledServices.reduce((acc, service) => {
          if (service.cluster >= 0) {
            acc[service.cluster] = (acc[service.cluster] || 0) + 1
          }
          return acc
        }, []),
      },
    }

    return new Response(JSON.stringify(finalResult, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
  } catch (error) {
    console.error('Scheduling API error:', error)
    return new Response(
      JSON.stringify(
        {
          error: 'Internal Server Error',
          details: error.message,
          scheduledServices: [],
          unassignedServices: [],
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

async function processDateRange(start, end) {
  const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
    params: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
  })

  const services = response.data.filter(service => {
    if (!service.time.range[0] || !service.time.range[1]) return false
    const serviceDate = dayjsInstance(service.date)
    return serviceDate.isBetween(start, end, null, '[)')
  })

  if (!services.length) {
    return new Response(
      JSON.stringify(
        {
          scheduledServices: [],
          unassignedServices: [],
        },
        null,
        2,
      ),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    )
  }

  const distanceMatrix = await getFullDistanceMatrix(
    [...new Set(services.map(s => s.location?.id?.toString()).filter(Boolean))],
    { format: 'array', force: true },
  )

  if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
    console.warn('Invalid distance matrix')
    return new Response(
      JSON.stringify(
        {
          scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
          unassignedServices: [],
        },
        null,
        2,
      ),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    )
  }

  const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

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

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  })
}
