import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'

const LOG_MATRIX = false
let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 4000

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
    const response = await axios.get(
      `http://localhost:${process.env.PORT}/api/services`,
      {
        params: { start: params.start, end: params.end },
      },
    )
    services = response.data.filter(
      service =>
        service.time.range[0] !== null && service.time.range[1] !== null,
    )
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
    path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
  )

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      if (currentRequestId === requestId) {
        console.log(
          `Worker timeout (${WORKER_TIMEOUT}ms) for request ${requestId}, terminating`,
        )
        await terminateWorker()
        resolve({ error: 'Worker timeout' })
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
        resolve({ error: error.message })
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
  const requestId = ++currentRequestId
  const { searchParams } = new URL(request.url)
  const params = {
    start: searchParams.get('start'),
    end: searchParams.get('end'),
    clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
    minPoints: parseInt(searchParams.get('minPoints'), 10) || 2,
    maxPoints: parseInt(searchParams.get('maxPoints'), 10) || 10,
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

    // Log clustering results
    console.log(
      `Results from clustering for request ${requestId} (${clusteringInfo.algorithm}${
        clusteringInfo.algorithm === 'kmeans' ? `, k = ${clusteringInfo.k}` : ''
      }):`,
    )
    console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)
    console.log(`Runtime: ${clusteringInfo.performanceDuration} ms`)

    // Log distance statistics
    console.log(
      `Distance: max ${clusteringInfo.maxDistance} mi, min ${clusteringInfo.minDistance} mi, avg ${clusteringInfo.avgDistance} mi`,
    )

    console.log(`Clusters:`, clusteringInfo.clusterDistribution)

    if (LOG_MATRIX) {
      console.log('Sample Distance Matrix (in miles):')
      console.log(
        clusteringInfo.sampleMatrix.map(row =>
          row.map(d => d?.toFixed(4) ?? 'null'),
        ),
      )
    }

    // Log outliers
    clusteringInfo.outliers.forEach((outlier, index) => {
      console.log(
        `Outlier ${index + 1}: ${outlier.company} [${outlier.latitude}, ${outlier.longitude}]`,
      )
    })

    if (
      clusteringInfo.totalClusters === 1 &&
      !clusteringInfo.noisePoints &&
      !clusteringInfo.outliersCount
    ) {
      console.warn(
        'Warning: Only one cluster was created. Consider adjusting the clustering parameters.',
      )
    }

    // Include clusteringInfo in the response
    const responseData = {
      clusteredServices,
      clusteringInfo,
    }

    setCachedData(cacheKey, responseData)
    return NextResponse.json(responseData)
  } catch (error) {
    console.error(`Error in cluster API for request ${requestId}:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  } finally {
    await terminateWorker()
  }
}
