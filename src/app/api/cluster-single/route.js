import { createDistanceMatrix } from '@/app/utils/distance'
import axios from 'axios'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

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
    currentAbortController.abort()
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

    const response = await axios.get(
      `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`,
      {
        params: { 
          start: params.start, 
          end: params.end 
        },
      }
    )

    services = response.data.filter(
      service => 
        service.time.range[0] !== null && 
        service.time.range[1] !== null
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

  const distanceMatrix = await createDistanceMatrix(services)
  if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
    console.warn(`Invalid distance matrix for request ${requestId}`)
    return { clusteredServices: services, clusteringInfo: {} }
  }

  currentWorker = new Worker(
    path.resolve(process.cwd(), 'src/app/api/cluster-single/worker.js')
  )

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      if (currentRequestId === requestId) {
        console.log(
          `Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`
        )
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
      distanceMatrix
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
    }

    const requestId = ++currentRequestId
    try {
      const result = await processRequest(params, requestId)

      if (currentRequestId !== requestId) {
        return new Response(
          JSON.stringify({
            error: 'Request superseded',
            clusteredServices: [],
            clusteringInfo: null,
          }),
          { status: 409 }
        )
      }

      return new Response(JSON.stringify(result), {
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
          clusteringInfo: null,
        }),
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Clustering API error:', error)
    return new Response(
      JSON.stringify({
        error: 'Internal Server Error',
        details: error.message,
        clusteredServices: [],
        clusteringInfo: null,
      }),
      { status: 500 }
    )
  }
} 