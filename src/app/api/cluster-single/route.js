import { createDistanceMatrix } from '@/app/utils/distance'
import axios from 'axios'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { logMapActivity } from '@/app/api/cluster-single/logging'

let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 10000

// Default date range constants
const DEFAULT_START = '2024-09-03T02:30:00.000Z'
const DEFAULT_END = '2024-09-03T12:30:00.000Z'

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
      params: {
        start: params.start,
        end: params.end,
      },
    })

    services = response.data.filter(
      service => service.time.range[0] !== null && service.time.range[1] !== null,
    )

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
  } catch (error) {
    console.error(`Error fetching services for request ${requestId}:`, error)
    throw error
  }

  const distanceMatrix = await createDistanceMatrix(services)
  if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
    console.warn(`Invalid distance matrix for request ${requestId}`)
    return { clusteredServices: services }
  }

  currentWorker = new Worker(path.resolve(process.cwd(), 'src/app/api/cluster-single/worker.js'))

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
        console.log(`Received result for request ${requestId}`)
        clearTimeout(timeoutId)
        await terminateWorker()

        // Ensure result has the expected structure
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

        // Calculate clustering metrics
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
            clusteredServices: [],
          }),
          { status: 409 },
        )
      }

      const finalResult = {
        clusteredServices: processedResult.clusteredServices,
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
          clusteredServices: [],
        }),
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('Clustering API error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        details: error.message,
        clusteredServices: [],
      }),
      { status: 500 },
    )
  }
}
