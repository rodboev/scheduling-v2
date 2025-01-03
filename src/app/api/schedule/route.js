import { getFullDistanceMatrix } from '@/app/utils/locationCache'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { dayjsInstance } from '@/app/utils/dayjs'
import axios from 'axios'

const MAX_DAYS_PER_REQUEST = 2 // Process 2 days at a time

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = dayjsInstance(searchParams.get('start'))
  const end = dayjsInstance(searchParams.get('end'))
  console.log('Schedule API called with params:', Object.fromEntries(searchParams))

  if (!start.isValid() || !end.isValid()) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  }

  try {
    console.log('Date range:', {
      normalizedStart: start.format(),
      normalizedEnd: end.format(),
    })

    // Calculate number of days in request
    const totalDays = end.diff(start, 'day')
    console.log('Total days requested:', totalDays)

    // If request is within limit, process normally
    if (totalDays <= MAX_DAYS_PER_REQUEST) {
      return await processDateRange(start, end)
    }

    // For larger ranges, process in chunks and combine results
    console.log('Processing large date range in chunks...')
    let currentStart = start
    let allScheduledServices = []
    let totalConnectedPoints = 0
    let totalClusters = 0
    let accumulatedTechAssignments = {}
    const startTime = performance.now()

    while (currentStart.isBefore(end)) {
      const chunkEnd = dayjsInstance.min(currentStart.add(MAX_DAYS_PER_REQUEST, 'day'), end)

      console.log(`Processing chunk: ${currentStart.format()} to ${chunkEnd.format()}`)
      const chunkResult = await processDateRange(currentStart, chunkEnd)
      const chunkData = await chunkResult.json()

      if (chunkData.scheduledServices) {
        allScheduledServices = allScheduledServices.concat(chunkData.scheduledServices)
        totalConnectedPoints += chunkData.clusteringInfo?.connectedPointsCount || 0
        totalClusters += chunkData.clusteringInfo?.totalClusters || 0

        // Merge tech assignments from this chunk
        const chunkTechAssignments = chunkData.clusteringInfo?.techAssignments || {}
        for (const [techId, assignment] of Object.entries(chunkTechAssignments)) {
          if (!accumulatedTechAssignments[techId]) {
            accumulatedTechAssignments[techId] = { services: 0, startTime: assignment.startTime }
          }
          accumulatedTechAssignments[techId].services += assignment.services
        }
      }

      currentStart = chunkEnd
    }

    return NextResponse.json({
      scheduledServices: allScheduledServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Math.round(performance.now() - startTime),
        connectedPointsCount: totalConnectedPoints,
        totalClusters,
        clusterDistribution: allScheduledServices.reduce((acc, service) => {
          if (service.cluster >= 0) {
            const cluster = service.cluster
            acc[cluster] = (acc[cluster] || 0) + 1
          }
          return acc
        }, []),
        techAssignments: accumulatedTechAssignments,
      },
    })
  } catch (error) {
    console.error('Schedule error:', error)
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error.message,
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: 0,
          connectedPointsCount: 0,
          totalClusters: 0,
          clusterDistribution: [],
          techAssignments: {},
        },
      },
      { status: 500 },
    )
  }
}

async function processDateRange(start, end) {
  const startTime = performance.now()

  try {
    // Get services for date range
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })

    const services = response.data.filter(service => {
      if (!service.time.range[0] || !service.time.range[1]) return false
      const serviceDate = dayjsInstance(service.date)
      return serviceDate.isBetween(start, end, null, '[)')
    })

    if (!services.length) {
      return NextResponse.json({
        scheduledServices: [],
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: 0,
          connectedPointsCount: 0,
          totalClusters: 0,
          clusterDistribution: [],
          techAssignments: {},
        },
      })
    }

    // Add originalIndex to each service
    services.forEach((service, index) => {
      service.originalIndex = index
    })

    // Filter out services with missing locations first
    const validServices = services.filter(service => service.location?.id?.toString())

    // Get unique location IDs from valid services
    const locationIds = validServices.map(s => s.location.id.toString())

    // Get distance matrix in array format
    console.log('Getting distance matrix for', locationIds.length, 'locations')
    const distanceMatrix = await getFullDistanceMatrix(locationIds, {
      format: 'array',
      force: true,
    })

    // Validate matrix format and dimensions
    if (!Array.isArray(distanceMatrix) || !Array.isArray(distanceMatrix[0])) {
      console.warn('Invalid distance matrix format')
      return NextResponse.json({
        scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: Math.round(performance.now() - startTime),
          connectedPointsCount: 0,
          totalClusters: 0,
          clusterDistribution: [],
          techAssignments: {},
        },
      })
    }

    if (distanceMatrix.length !== validServices.length) {
      console.warn(
        `Matrix dimension mismatch: ${distanceMatrix.length} != ${validServices.length} services`,
      )
      return NextResponse.json({
        scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
        unassignedServices: [],
        clusteringInfo: {
          algorithm: 'shifts',
          performanceDuration: Math.round(performance.now() - startTime),
          connectedPointsCount: 0,
          totalClusters: 0,
          clusterDistribution: [],
          techAssignments: {},
        },
      })
    }

    // Create worker
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

    // Get result from worker with timeout
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timed out'))
      }, 30000)

      worker.on('message', result => {
        clearTimeout(timeout)
        worker.terminate()
        resolve(result)
      })

      worker.on('error', error => {
        clearTimeout(timeout)
        worker.terminate()
        reject(error)
      })

      // Pass valid services and their distance matrix to worker
      worker.postMessage({ services: validServices, distanceMatrix })
    })

    // Add clustering info to the result
    const scheduledServices = result.scheduledServices || []
    const totalConnectedPoints = scheduledServices.filter(s => s.cluster >= 0).length
    const totalClusters = new Set(scheduledServices.map(s => s.cluster).filter(c => c >= 0)).size

    return NextResponse.json({
      ...result,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Math.round(performance.now() - startTime),
        connectedPointsCount: totalConnectedPoints,
        totalClusters,
        clusterDistribution: scheduledServices.reduce((acc, service) => {
          if (service.cluster >= 0) {
            const cluster = service.cluster
            acc[cluster] = (acc[cluster] || 0) + 1
          }
          return acc
        }, []),
        techAssignments: result.clusteringInfo?.techAssignments || {},
      },
    })
  } catch (error) {
    console.error('Schedule error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
