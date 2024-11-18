import { getDefaultDateRange } from '@/app/utils/dates'
import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { scheduleServices } from './scheduling'

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
  const startTime = Date.now()

  try {
    const services = await fetchServices(params)
    
    if (!services.length) {
      return {
        clusters: [],
        clusteringInfo: {
          totalClusters: 0,
          totalServices: 0,
          averageServicesPerCluster: 0,
          distanceBias: params.distanceBias
        }
      }
    }

    const distanceMatrix = await createDistanceMatrix(services)
    if (!distanceMatrix?.length) {
      throw new Error('Failed to create distance matrix')
    }

    const result = scheduleServices(services, distanceMatrix, {
      distanceBias: params.distanceBias,
      singleCluster: params.singleCluster
    })
    
    return {
      ...result,
      clusteringInfo: {
        ...result.clusteringInfo,
        performanceDuration: Date.now() - startTime,
        algorithm: 'distance-optimized-scheduling'
      }
    }
  } catch (error) {
    console.error(`Error processing request ${requestId}:`, error)
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
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      minPoints: parseInt(searchParams.get('minPoints')) || 8,
      maxPoints: parseInt(searchParams.get('maxPoints')) || 14,
      clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
      algorithm: searchParams.get('algorithm') || 'kmeans',
      distanceBias: parseInt(searchParams.get('distanceBias')) || 50,
      singleCluster: searchParams.get('singleCluster') === 'true',
    }

    // Validate date parameters
    if (!params.start || !params.end) {
      return new Response(
        JSON.stringify({
          error: 'Missing date parameters',
          clusteredServices: [],
          clusteringInfo: null,
        }),
        { status: 400 },
      )
    }

    // Fetch services
    let services = []
    try {
      services = await fetchServices(params)
    } catch (error) {
      console.error('Error fetching services:', error)
      return new Response(
        JSON.stringify({
          error: 'Failed to fetch services',
          clusteredServices: [],
          clusteringInfo: null,
        }),
        { status: 500 },
      )
    }

    // If no services found, return empty result
    if (!services?.length) {
      return new Response(
        JSON.stringify({
          clusteredServices: [],
          clusteringInfo: {
            performanceDuration: 0,
            connectedPointsCount: 0,
            totalClusters: 0,
            outlierCount: 0,
            algorithm: params.algorithm,
          },
        }),
        { status: 200 },
      )
    }

    const distanceMatrix = await createDistanceMatrix(services)
    if (!distanceMatrix?.length) {
      return new Response(
        JSON.stringify({
          error: 'Failed to create distance matrix',
          clusteredServices: [],
          clusteringInfo: null,
        }),
        { status: 500 },
      )
    }

    const requestId = ++currentRequestId
    try {
      const result = await processRequest(
        { ...params, services, distanceMatrix },
        requestId,
      )

      if (currentRequestId !== requestId) {
        return new Response(
          JSON.stringify({
            error: 'Request superseded',
            clusteredServices: [],
            clusteringInfo: null,
          }),
          { status: 409 },
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
        clusteringInfo: null,
      }),
      { status: 500 },
    )
  }
}

async function fetchServices(params) {
  try {
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

    if (!response.data) {
      console.error('No data returned from services API')
      return []
    }

    return response.data.filter(
      service =>
        service?.time?.range?.[0] !== null &&
        service?.time?.range?.[1] !== null,
    )
  } catch (error) {
    console.error('Error fetching services:', error)
    throw error
  }
}
