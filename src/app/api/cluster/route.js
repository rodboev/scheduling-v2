import { getDefaultDateRange } from '@/app/utils/dates'
import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
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
    currentAbortController.abort()
    await terminateWorker()
  }

  currentRequestId = requestId
  currentAbortController = new AbortController()

  try {
    const services = await fetchServices(params)
    if (!services?.length) {
      console.warn('No services found')
      return { error: 'No services found' }
    }

    const distanceMatrix = await createDistanceMatrix(services)
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      return { error: 'Invalid distance matrix' }
    }

    currentWorker = new Worker(
      path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
    )

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        if (currentRequestId === requestId) {
          console.log(
            `Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`,
          )
          await terminateWorker()
          resolve({
            error: 'Worker timeout - clustering operation took too long',
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
          resolve({ error: `Worker error: ${error.message}` })
        }
      })

      currentWorker.on('exit', code => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`)
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

      try {
        currentWorker.postMessage({
          services,
          distanceMatrix,
          minPoints: params.minPoints,
          maxPoints: params.maxPoints,
          clusterUnclustered: params.clusterUnclustered,
          algorithm: params.algorithm,
        })
      } catch (error) {
        console.error('Error posting message to worker:', error)
        clearTimeout(timeoutId)
        terminateWorker()
        resolve({ error: 'Failed to start clustering operation' })
      }
    })
  } catch (error) {
    console.error('Error in processRequest:', error)
    return { error: error.message }
  }
}

async function terminateWorker() {
  if (currentWorker) {
    try {
      await new Promise(resolve => {
        currentWorker.once('exit', resolve)
        currentWorker.terminate()
      })
    } catch (error) {
      console.error('Error terminating worker:', error)
    }
    currentWorker = null
  }
  currentAbortController = null
}

export async function GET(request) {
  const requestId = ++currentRequestId
  const { searchParams } = new URL(request.url)
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange()

  const params = {
    start: searchParams.get('start') || defaultStart,
    end: searchParams.get('end') || defaultEnd,
    clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
    minPoints: Number.parseInt(searchParams.get('minPoints'), 10) || 2,
    maxPoints: Number.parseInt(searchParams.get('maxPoints'), 10) || 10,
    algorithm: searchParams.get('algorithm') || 'kmeans',
  }

  if (!params.start || !params.end) {
    console.log(`Request ${requestId} missing start or end date`)
    return NextResponse.json(
      { error: 'Missing start or end date' },
      { status: 400 },
    )
  }

  const cacheKey = `clusteredServices:${JSON.stringify(params)}`
  const cachedData = getCachedData(cacheKey)

  if (cachedData) {
    return NextResponse.json(cachedData)
  }

  try {
    const result = await processRequest(params, requestId)

    if (currentRequestId !== requestId) {
      console.log(`Request ${requestId} superseded by a newer request`)
      return NextResponse.json({ error: 'Request superseded' }, { status: 409 })
    }

    if (result.error) {
      console.error(
        `Error in cluster API for request ${requestId}:`,
        result.error,
      )
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const { clusteredServices, clusteringInfo } = result

    const responseData = {
      clusteredServices,
      clusteringInfo,
    }

    setCachedData(cacheKey, responseData)
    return NextResponse.json(responseData)
  } catch (error) {
    console.error('Error in cluster API:', error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}

async function fetchServices(params) {
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange()

  const response = await axios.get(
    `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`,
    {
      params: {
        start: params.start || defaultStart,
        end: params.end || defaultEnd,
      },
    },
  )
  return response.data.filter(
    service => service.time.range[0] !== null && service.time.range[1] !== null,
  )
}
