import { createDistanceMatrix } from '@/app/utils/distance'
import axios from 'axios'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 5000 // Reduced timeout

// Cache for service data with multiple days
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

  // Update cache for this day
  serviceCache.set(cacheKey, {
    data: services,
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
        clusteredServices: [],
        performanceDuration: 0,
        totalClusters: 0,
        connectedPointsCount: 0,
        outlierCount: 0,
      }
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    currentWorker = new Worker(path.resolve(process.cwd(), 'src/app/api/cluster-single/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn(`Invalid distance matrix for request ${requestId}`)
      return { clusteredServices: services }
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        if (currentRequestId === requestId) {
          console.log(`Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`)
          await terminateWorker()
          resolve({
            clusteredServices: services,
            performanceDuration: WORKER_TIMEOUT,
            totalClusters: 1,
            connectedPointsCount: services.length,
            outlierCount: 0,
          })
        }
      }, WORKER_TIMEOUT)

      currentWorker.on('message', async result => {
        if (currentRequestId === requestId) {
          clearTimeout(timeoutId)
          await terminateWorker()

          if (!result?.clusteredServices) {
            console.error('Invalid worker result structure:', result)
            resolve({
              clusteredServices: services.map(service => ({
                ...service,
                cluster: -1,
              })),
              performanceDuration: 0,
              totalClusters: 0,
              connectedPointsCount: 0,
              outlierCount: services.length,
            })
            return
          }

          const clusteredCount = result.clusteredServices.filter(s => s.cluster >= 0).length
          const clusters = new Set(result.clusteredServices.map(s => s.cluster).filter(c => c >= 0))

          resolve({
            clusteredServices: result.clusteredServices,
            performanceDuration: result.clusteringInfo?.performanceDuration || 0,
            totalClusters: clusters.size,
            connectedPointsCount: clusteredCount,
            outlierCount: result.clusteredServices.length - clusteredCount,
          })
        }
      })

      currentWorker.on('error', async error => {
        if (currentRequestId === requestId) {
          console.error(`Worker error for request ${requestId}:`, error)
          clearTimeout(timeoutId)
          await terminateWorker()
          resolve({
            clusteredServices: services,
            performanceDuration: 0,
            totalClusters: 1,
            connectedPointsCount: services.length,
            outlierCount: 0,
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
      start: searchParams.get('start') || DEFAULT_START,
      end: searchParams.get('end') || DEFAULT_END,
      algorithm: searchParams.get('algorithm') || 'kmeans',
    }

    const requestId = ++currentRequestId
    try {
      const processedResult = await processRequest(params, requestId)

      if (currentRequestId !== requestId) {
        return new Response(
          JSON.stringify({
            error: 'Request superseded',
            scheduledServices: [],
          }),
          { status: 409 },
        )
      }

      // Group services by cluster
      const clusters = processedResult.clusteredServices
        .filter(service => service.cluster >= 0 && service.start)
        .reduce((acc, service) => {
          if (!acc[service.cluster]) acc[service.cluster] = []
          acc[service.cluster].push(service)
          return acc
        }, {})

      // Sort and assign sequence numbers within each cluster
      const servicesWithSequence = Object.values(clusters).flatMap(clusterServices => {
        return clusterServices
          .sort((a, b) => new Date(a.start) - new Date(b.start))
          .map((service, index) => ({
            ...service,
            sequenceNumber: index + 1,
          }))
      })

      // Add back any services without clusters or start times
      const unscheduledServices = processedResult.clusteredServices
        .filter(service => service.cluster < 0 || !service.start)
        .map(service => ({
          ...service,
          sequenceNumber: null,
        }))

      const finalResult = {
        scheduledServices: [...servicesWithSequence, ...unscheduledServices],
        clusteringInfo: {
          performanceDuration: processedResult.performanceDuration || 0,
          connectedPointsCount: processedResult.clusteredServices.length || 0,
          totalClusters: processedResult.totalClusters || 0,
          outlierCount: processedResult.outlierCount || 0,
          algorithm: params.algorithm,
        },
      }

      return new Response(JSON.stringify(finalResult), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    } catch (error) {
      console.error('Processing error:', error)
      return new Response(
        JSON.stringify({
          error: 'Processing failed',
          scheduledServices: [],
        }),
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Clustering API error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
        scheduledServices: [],
      }),
      { status: 500 },
    )
  }
}
