import { createDistanceMatrix } from '@/app/utils/distance'
import { getRedisClient } from '@/app/utils/redis'
import { NextResponse } from 'next/server'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

const LOG_MATRIX = false
let currentWorker = null
let currentAbortController = null
let currentRequestId = 0
const WORKER_TIMEOUT = 30000 // Increased timeout for larger datasets

async function processRequest(params, requestId) {
  if (currentWorker) {
    console.log(`Terminating existing worker for request ${currentRequestId}`)
    currentAbortController.abort()
    await terminateWorker()
  }

  currentRequestId = requestId
  currentAbortController = new AbortController()

  // Get services from Redis
  const redis = getRedisClient()
  let services = []
  try {
    // Convert dates to UTC timestamps and ensure they're numbers
    const startDate = new Date(params.start)
    const endDate = new Date(params.end)
    const startTimestamp = startDate.getTime()
    const endTimestamp = endDate.getTime()

    console.log('Searching Redis with timestamps:', {
      start: startTimestamp,
      startISO: startDate.toISOString(),
      end: endTimestamp,
      endISO: endDate.toISOString(),
    })

    // Get all services to verify data
    const allServices = await redis.zrange('services', 0, -1, 'WITHSCORES')
    console.log(
      'First few services in Redis:',
      allServices
        .slice(0, 6)
        .map((val, i) =>
          i % 2 === 0 ? val : `${val} (${new Date(Number(val)).toISOString()})`,
        ),
    )

    // Use numeric comparison for timestamps
    const serviceIds = await redis.zrangebyscore(
      'services',
      startTimestamp, // Remove quotes and parentheses
      endTimestamp,
    )

    console.log(`Found ${serviceIds.length} service IDs between:`, {
      start: new Date(startTimestamp).toISOString(),
      end: new Date(endTimestamp).toISOString(),
    })

    if (serviceIds.length === 0) {
      // Log the range we're searching
      console.log('Search range:', {
        start: startTimestamp,
        end: endTimestamp,
        startDate: new Date(startTimestamp).toLocaleString(),
        endDate: new Date(endTimestamp).toLocaleString(),
      })

      // Get min and max timestamps from Redis to verify range
      const minScore = await redis.zrange('services', 0, 0, 'WITHSCORES')
      const maxScore = await redis.zrange('services', -1, -1, 'WITHSCORES')

      console.log('Available data range:', {
        min: minScore[1] ? new Date(Number(minScore[1])).toISOString() : 'none',
        max: maxScore[1] ? new Date(Number(maxScore[1])).toISOString() : 'none',
      })
    }

    console.log(`Found ${serviceIds.length} service IDs in time range`)

    if (serviceIds.length === 0) {
      // Double check what data exists in this range
      const allServices = await redis.zrange('services', 0, -1, 'WITHSCORES')
      const sampleServices = allServices.slice(0, 6)
      console.log(
        'Sample of all services:',
        sampleServices.map((val, i) =>
          i % 2 === 0 ? val : new Date(Number.parseInt(val)).toISOString(),
        ),
      )
    }

    console.log(`Found ${serviceIds.length} service IDs in time range`)

    // Get full service data
    services = await Promise.all(
      serviceIds.map(async serviceId => {
        try {
          const data = await redis.hgetall(`service:${serviceId}`)
          if (!data || !data.time || !data.location) {
            console.warn(`Missing required fields for service ${serviceId}`)
            return null
          }

          // Parse JSON fields with validation
          let parsedTime
          let parsedLocation
          let parsedTech
          let parsedSchedule

          try {
            parsedTime = JSON.parse(data.time)
            parsedLocation = JSON.parse(data.location)
            parsedTech = data.tech ? JSON.parse(data.tech) : null
            parsedSchedule = data.schedule ? JSON.parse(data.schedule) : null
          } catch (parseError) {
            console.error(
              `JSON parse error for service ${serviceId}:`,
              parseError,
            )
            return null
          }

          // Validate required nested fields
          if (
            !parsedTime?.range?.length ||
            !parsedTime?.preferred ||
            !parsedTime?.duration ||
            !parsedLocation?.latitude ||
            !parsedLocation?.longitude
          ) {
            console.warn(`Invalid required fields for service ${serviceId}`)
            return null
          }

          const parsedService = {
            ...data,
            id: serviceId,
            time: parsedTime,
            location: parsedLocation,
            tech: parsedTech || {
              code: '',
              name: '',
              enforced: false,
            },
            schedule: parsedSchedule || {
              code: '',
              timesPerYear: 0,
            },
            cluster: -1,
          }

          return parsedService
        } catch (error) {
          console.error(`Error processing service ${serviceId}:`, error)
          return null
        }
      }),
    )

    // Filter out invalid services
    services = services.filter(Boolean)

    console.log(`Retrieved ${services.length} valid services from Redis`)

    // Add validation and logging
    if (!services || services.length === 0) {
      console.warn('No valid services found after processing')
      return {
        scheduledServices: [],
        clusteringInfo: {
          error: 'No valid services found in the specified time range',
        },
      }
    }

    console.log(`Processing ${services.length} services for clustering`)

    // Sort services by preferred time
    services.sort((a, b) => {
      const timeA = new Date(a.time.preferred).getTime()
      const timeB = new Date(b.time.preferred).getTime()
      return timeA - timeB
    })
  } catch (error) {
    console.error(`Error fetching services for request ${requestId}:`, error)
    throw error
  }

  const distanceMatrix = await createDistanceMatrix(services)
  if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
    console.warn(`Invalid distance matrix for request ${requestId}`)
    return { clusteredServices: services, clusteringInfo: {} }
  }

  if (LOG_MATRIX) {
    console.log('Distance Matrix:', distanceMatrix)
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

        if (result.error) {
          console.error(
            `Error in cluster API for request ${requestId}:`,
            result.error,
          )
          await terminateWorker()
          resolve({ error: result.error })
          return
        }

        // Make sure we're returning scheduledServices, not clusteredServices
        const { scheduledServices, clusteringInfo } = result

        // // Log clustering results
        // console.log(
        //   `Results from clustering for request ${requestId} (${clusteringInfo.algorithm}${
        //     clusteringInfo.algorithm === 'kmeans' ? `, k = ${clusteringInfo.k}` : ''
        //   }):`
        // )
        // console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)
        // console.log(`Runtime: ${clusteringInfo.performanceDuration} ms`)

        // // Log distance statistics
        // console.log(
        //   `Distance: max ${clusteringInfo.maxDistance} mi, min ${clusteringInfo.minDistance} mi, avg ${clusteringInfo.avgDistance} mi`
        // )

        // // Log cluster distribution
        // console.log('Clusters:', clusteringInfo.clusterDistribution)

        // if (LOG_MATRIX) {
        //   console.log('Sample Distance Matrix (in miles):')
        //   console.log(
        //     clusteringInfo.sampleMatrix?.map(row =>
        //       row.map(d => d?.toFixed(4) ?? 'null')
        //     )
        //   )
        // }

        // // Log outliers
        // clusteringInfo.outliers?.forEach((outlier, index) => {
        //   console.log(
        //     `Outlier ${index + 1}: ${outlier.company} [${outlier.latitude}, ${outlier.longitude}]`
        //   )
        // })

        // if (
        //   clusteringInfo.totalClusters === 1 &&
        //   !clusteringInfo.noisePoints &&
        //   !clusteringInfo.outliersCount
        // ) {
        //   console.warn(
        //     'Warning: Only one cluster was created. Consider adjusting the clustering parameters.'
        //   )
        // }

        // // Cache successful results in Redis
        // const cacheKey = `cluster:${JSON.stringify(params)}`
        // await redis.setex(
        //   cacheKey,
        //   3600,
        //   JSON.stringify({ clusteredServices, clusteringInfo })
        // )

        // Log for debugging
        console.log(
          `Returning ${scheduledServices?.length || 0} scheduled services`,
        )
        await terminateWorker()
        resolve({ scheduledServices, clusteringInfo })
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
      distanceBias: params.distanceBias,
      scheduleOptimization: true,
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
    minPoints: Number.parseInt(searchParams.get('minPoints') || '6', 10),
    maxPoints: Number.parseInt(searchParams.get('maxPoints') || '16', 10),
    algorithm: searchParams.get('algorithm') || 'dbscan',
    distanceBias: Number.parseFloat(searchParams.get('distanceBias') || '0.5'),
    scheduleOptimization: true,
  }

  if (!params.start || !params.end) {
    console.log(`Request ${requestId} missing start or end date`)
    return NextResponse.json(
      { error: 'Missing start or end date' },
      { status: 400 },
    )
  }

  try {
    // Check Redis cache first
    const redis = getRedisClient()
    const cacheKey = `cluster:${JSON.stringify(params)}`
    const cachedResult = await redis.get(cacheKey)

    if (cachedResult) {
      return NextResponse.json(JSON.parse(cachedResult))
    }

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

    // Add debug logging
    console.log(
      `API returning ${result.scheduledServices?.length || 0} services`,
    )

    return NextResponse.json(result)
    //     return NextResponse.json({
    //       scheduledServices: result.scheduledServices || [],
    //       unassignedServices: result.unassignedServices || [],
    //       clusteringInfo: {
    //         ...result.clusteringInfo,
    //         totalServices:
    //           (result.scheduledServices?.length || 0) +
    //           (result.unassignedServices?.length || 0),
    //         assignedCount: result.scheduledServices?.length || 0,
    //         unassignedCount: result.unassignedServices?.length || 0,
    //       },
    //     })
  } catch (error) {
    console.error(`Error in cluster API for request ${requestId}:`, error)
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message },
      { status: 500 },
    )
  }
}
