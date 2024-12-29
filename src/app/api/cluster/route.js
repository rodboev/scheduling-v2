import { getDefaultDateRange } from '@/app/utils/dates'
import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/locationCache'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

const LOG_MATRIX = false
let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 10000

async function processRequest(params, requestId) {
  if (currentWorker) {
    console.log(`Terminating existing worker for request ${currentRequestId}`)
    if (currentAbortController) currentAbortController.abort()
    await terminateWorker()
  }

  currentRequestId = requestId
  currentAbortController = new AbortController()

  let services = []
  try {
    console.log('Fetching services with params:', {
      start: params.start,
      end: params.end,
      requestId,
    })

    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: { start: params.start, end: params.end },
    })

    services = response.data.filter(
      service => service.time.range[0] !== null && service.time.range[1] !== null,
    )

    console.log(`Found ${services.length} services for request ${requestId}`)

    if (!services.length) {
      return {
        clusteredServices: [],
        clusteringInfo: {
          performanceDuration: 0,
          connectedPointsCount: 0,
          totalClusters: 0,
          outlierCount: 0,
        },
      }
    }
  } catch (error) {
    console.error(`Error fetching services for request ${requestId}:`, error)
    throw error
  }

  // Generate cache key based on service IDs
  const cacheKey = `clusters:${services.map(s => s.id).join(',')}`
  const cachedResult = getCachedData(cacheKey)
  if (cachedResult) {
    return cachedResult
  }

  const distanceMatrix = await createDistanceMatrix(services)
  if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
    console.warn(`Invalid distance matrix for request ${requestId}`)
    return { clusteredServices: services, clusteringInfo: {} }
  }

  currentWorker = new Worker(path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'))

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      if (currentRequestId === requestId) {
        console.log(`Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`)
        await terminateWorker()
        resolve({
          clusteredServices: services,
          clusteringInfo: {
            performanceDuration: WORKER_TIMEOUT,
            connectedPointsCount: services.length,
            totalClusters: 1,
            outlierCount: 0,
          },
        })
      }
    }, WORKER_TIMEOUT)

    currentWorker.on('message', async result => {
      if (currentRequestId === requestId) {
        console.log(`Received result for request ${requestId}`)
        clearTimeout(timeoutId)
        await terminateWorker()
        // Cache the result before resolving
        setCachedData(cacheKey, result)
        resolve(result)
      }
    })

    currentWorker.on('error', async error => {
      if (currentRequestId === requestId) {
        console.error(`Worker error for request ${requestId}:`, error)
        clearTimeout(timeoutId)
        await terminateWorker()
        resolve({
          clusteredServices: services,
          clusteringInfo: {
            performanceDuration: 0,
            connectedPointsCount: services.length,
            totalClusters: 1,
            outlierCount: 0,
          },
        })
      }
    })

    currentAbortController.signal.addEventListener('abort', async () => {
      if (currentRequestId === requestId) {
        console.log(`Request ${requestId} aborted`)
        clearTimeout(timeoutId)
        await terminateWorker()
        reject(new Error('Worker aborted'))
      }
    })

    currentWorker.postMessage({
      services,
      distanceMatrix,
      minPoints: params.minPoints,
      maxPoints: params.maxPoints,
      clusterUnclustered: params.clusterUnclustered,
      algorithm: params.algorithm,
    })
  })
}

async function terminateWorker() {
  if (currentWorker) {
    await new Promise(resolve => {
      currentWorker.once('exit', resolve)
      currentWorker.terminate()
    })
    currentWorker = null
  }
  currentAbortController = null
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const params = {
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      minPoints: parseInt(searchParams.get('minPoints')) || 8,
      maxPoints: parseInt(searchParams.get('maxPoints')) || 14,
      clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
      algorithm: searchParams.get('algorithm') || 'kmeans',
    }

    // Validate date parameters
    if (!params.start || !params.end) {
      return NextResponse.json(
        {
          error: 'Missing date parameters',
          clusteredServices: [],
          clusteringInfo: null,
        },
        { status: 400 },
      )
    }

    // Fetch services
    let services = []
    try {
      services = await fetchServices(params)
    } catch (error) {
      console.error('Error fetching services:', error)
      return NextResponse.json(
        {
          error: 'Failed to fetch services',
          clusteredServices: [],
          clusteringInfo: null,
        },
        { status: 500 },
      )
    }

    // If no services found, return empty result
    if (!services?.length) {
      return NextResponse.json({
        clusteredServices: [],
        clusteringInfo: {
          performanceDuration: 0,
          connectedPointsCount: 0,
          totalClusters: 0,
          outlierCount: 0,
          algorithm: params.algorithm,
        },
      })
    }

    const distanceMatrix = await createDistanceMatrix(services)
    if (!distanceMatrix?.length) {
      return NextResponse.json(
        {
          error: 'Failed to create distance matrix',
          clusteredServices: [],
          clusteringInfo: null,
        },
        { status: 500 },
      )
    }

    const requestId = ++currentRequestId
    try {
      const result = await processRequest({ ...params, services, distanceMatrix }, requestId)

      if (currentRequestId !== requestId) {
        return NextResponse.json(
          {
            error: 'Request superseded',
            clusteredServices: [],
            clusteringInfo: null,
          },
          { status: 409 },
        )
      }

      return NextResponse.json(result)
    } catch (error) {
      console.error('Processing error:', error)
      return NextResponse.json(
        {
          error: 'Processing failed',
          clusteredServices: [],
          clusteringInfo: null,
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Clustering API error:', error)
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error.message,
        clusteredServices: [],
        clusteringInfo: null,
      },
      { status: 500 },
    )
  }
}

async function fetchServices(params) {
  try {
    const { start: defaultStart, end: defaultEnd } = getDefaultDateRange()
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: params.start || defaultStart,
        end: params.end || defaultEnd,
      },
    })

    if (!response.data) {
      console.error('No data returned from services API')
      return []
    }

    return response.data.filter(
      service => service?.time?.range?.[0] !== null && service?.time?.range?.[1] !== null,
    )
  } catch (error) {
    console.error('Error fetching services:', error)
    throw error
  }
}
