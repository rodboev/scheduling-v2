import { createDistanceMatrix } from '@/app/utils/distance'
import axios from 'axios'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { NextResponse } from 'next/server'

let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 5000 // 5 second timeout

// Cache for service data
const serviceCache = new Map()

// Helper to get cache key
function getCacheKey(start, end) {
  const startDate = new Date(start).toISOString().split('T')[0]
  const endDate = new Date(end).toISOString().split('T')[0]
  return `${startDate}_${endDate}`
}

async function fetchServices(params, requestId) {
  const cacheKey = getCacheKey(params.start, params.end)
  const cachedData = serviceCache.get(cacheKey)

  // Check if we have valid cached data
  if (
    cachedData?.data &&
    Date.now() - cachedData.timestamp < 300000 // Cache for 5 minutes
  ) {
    console.log('Using cached services data for', cacheKey)
    return cachedData.data
  }

  console.log('Fetching services with params:', {
    start: params.start,
    end: params.end,
    requestId,
  })

  const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
    params: {
      start: params.start,
      end: params.end,
    },
  })

  const services = response.data.filter(
    service => service.time.range[0] !== null && service.time.range[1] !== null,
  )

  // Update cache
  serviceCache.set(cacheKey, {
    data: services,
    timestamp: Date.now(),
  })

  // Clean up old cache entries
  const now = Date.now()
  for (const [key, value] of serviceCache.entries()) {
    if (now - value.timestamp > 300000) {
      serviceCache.delete(key)
    }
  }

  return services
}

async function processRequest(params, requestId) {
  if (currentWorker) {
    console.log(`Terminating existing worker for request ${currentRequestId}`)
    if (currentAbortController) currentAbortController.abort()
    await terminateWorker()
  }

  currentRequestId = requestId
  currentAbortController = new AbortController()

  try {
    const services = await fetchServices(params, requestId)
    console.log(`Found ${services.length} services for request ${requestId}`)

    if (!services.length) {
      return {
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          totalClusters: 0,
          connectedPointsCount: 0,
          outlierCount: 0,
          performanceDuration: 0,
        },
      }
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    currentWorker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn(`Invalid distance matrix for request ${requestId}`)
      return { scheduledServices: services }
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        if (currentRequestId === requestId) {
          console.log(`Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`)
          await terminateWorker()
          resolve({
            scheduledServices: services,
            unassignedServices: [],
            clusteringInfo: {
              totalClusters: 1,
              connectedPointsCount: services.length,
              outlierCount: 0,
              performanceDuration: WORKER_TIMEOUT,
            },
          })
        }
      }, WORKER_TIMEOUT)

      currentWorker.on('message', async result => {
        if (currentRequestId === requestId) {
          clearTimeout(timeoutId)
          await terminateWorker()

          if (!result?.scheduledServices) {
            console.error('Invalid worker result structure:', result)
            resolve({
              scheduledServices: services.map(service => ({
                ...service,
                cluster: -1,
              })),
              unassignedServices: [],
              clusteringInfo: {
                totalClusters: 0,
                connectedPointsCount: 0,
                outlierCount: services.length,
                performanceDuration: 0,
              },
            })
            return
          }

          const clusteredCount = result.scheduledServices.filter(s => s.cluster >= 0).length
          const clusters = new Set(result.scheduledServices.map(s => s.cluster).filter(c => c >= 0))

          resolve({
            scheduledServices: result.scheduledServices,
            unassignedServices: result.unassignedServices || [],
            clusteringInfo: {
              totalClusters: clusters.size,
              connectedPointsCount: clusteredCount,
              outlierCount: result.scheduledServices.length - clusteredCount,
              performanceDuration: result.performanceDuration || 0,
            },
          })
        }
      })

      currentWorker.on('error', async error => {
        if (currentRequestId === requestId) {
          console.error(`Worker error for request ${requestId}:`, error)
          clearTimeout(timeoutId)
          await terminateWorker()
          resolve({
            scheduledServices: services,
            unassignedServices: [],
            clusteringInfo: {
              totalClusters: 1,
              connectedPointsCount: services.length,
              outlierCount: 0,
              performanceDuration: 0,
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
      })
    })
  } catch (error) {
    console.error(`Error in processRequest for request ${requestId}:`, error)
    throw error
  }
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
      start: searchParams.get('start') || '2024-09-03T02:30:00.000Z',
      end: searchParams.get('end') || '2024-09-03T12:30:00.999Z',
    }

    const requestId = ++currentRequestId
    try {
      const processedResult = await processRequest(params, requestId)

      if (currentRequestId !== requestId) {
        return NextResponse.json(
          {
            error: 'Request superseded',
            scheduledServices: [],
            unassignedServices: [],
            clusteringInfo: {
              totalClusters: 0,
              connectedPointsCount: 0,
              outlierCount: 0,
              performanceDuration: 0,
            },
          },
          { status: 409 },
        )
      }

      return NextResponse.json(processedResult)
    } catch (error) {
      console.error('Processing error:', error)
      return NextResponse.json(
        {
          error: 'Processing failed',
          scheduledServices: [],
          unassignedServices: [],
          clusteringInfo: {
            totalClusters: 0,
            connectedPointsCount: 0,
            outlierCount: 0,
            performanceDuration: 0,
          },
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Schedule API error:', error)
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error.message,
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          totalClusters: 0,
          connectedPointsCount: 0,
          outlierCount: 0,
          performanceDuration: 0,
        },
      },
      { status: 500 },
    )
  }
}
