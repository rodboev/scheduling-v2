import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'

const LOG_MATRIX = false
let currentWorker = null
let currentAbortController = null
let lastRequestTimestamp = 0

const WORKER_TIMEOUT = 30000 // 30 seconds timeout
const CHECK_INTERVAL = 1000 // Check every 1 second

export async function GET(request) {
  const currentRequestTimestamp = Date.now()
  lastRequestTimestamp = currentRequestTimestamp

  try {
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

    let services = (
      await axios.get(`http://localhost:${process.env.PORT}/api/services`, {
        params: { start: params.start, end: params.end },
      })
    ).data.filter(
      service =>
        service.time.range[0] !== null && service.time.range[1] !== null,
    )

    const distanceMatrix = await createDistanceMatrix(services)
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      return NextResponse.json(services)
    }

    // Terminate the current worker if it exists
    if (currentWorker) {
      console.log('Terminating existing worker due to new request')
      currentAbortController.abort()
      currentWorker.terminate()
      currentWorker = null
      currentAbortController = null
    }

    // Create a new AbortController
    currentAbortController = new AbortController()

    // Create a new worker
    currentWorker = new Worker(
      path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
    )

    const checkForNewRequests = () => {
      if (lastRequestTimestamp > currentRequestTimestamp) {
        console.log('New request detected, terminating current worker')
        currentAbortController.abort()
        currentWorker.terminate()
        currentWorker = null
        currentAbortController = null
        throw new Error('New request detected')
      }
    }

    const { clusteredServices, clusteringInfo } = await Promise.race([
      new Promise((resolve, reject) => {
        const intervalId = setInterval(checkForNewRequests, CHECK_INTERVAL)

        currentWorker.on('message', result => {
          clearInterval(intervalId)
          resolve(result)
        })
        currentWorker.on('error', error => {
          clearInterval(intervalId)
          reject(error)
        })
        currentWorker.postMessage({
          services,
          distanceMatrix,
          minPoints: params.minPoints,
          maxPoints: params.maxPoints,
          clusterUnclustered: params.clusterUnclustered,
          algorithm: params.algorithm,
        })
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Worker timeout')), WORKER_TIMEOUT),
      ),
      new Promise((_, reject) => {
        currentAbortController.signal.addEventListener('abort', () =>
          reject(new Error('Worker aborted')),
        )
      }),
    ])

    // Clear the currentWorker reference after it's done
    if (currentWorker) {
      currentWorker.terminate()
      currentWorker = null
      currentAbortController = null
    }

    // Log clustering results
    console.log(
      `Results from clustering (${clusteringInfo.algorithm}${
        clusteringInfo.algorithm === 'K-means'
          ? `, k = ${clusteringInfo.k}`
          : ''
      }):`,
    )
    console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)

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

    console.log(`Runtime: ${clusteringInfo.performanceDuration} ms`)

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
    console.error('Error in cluster API:', error)
    // Make sure to clear the currentWorker reference if there's an error
    if (currentWorker) {
      console.log('Terminating worker due to error')
      currentWorker.terminate()
      currentWorker = null
      currentAbortController = null
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
