import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'

const MILES_TO_METERS = 1609.34

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const params = {
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
      minPoints: parseInt(searchParams.get('minPoints'), 10) || 6,
      maxPoints: parseInt(searchParams.get('maxPoints'), 10) || 12,
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

    let services = await axios.get(
      `http://localhost:${process.env.PORT}/api/services`,
      {
        params: { start: params.start, end: params.end },
      },
    )

    services = services.data.filter(service =>
      service.location.address2.includes('New York, NY'),
    )

    const distanceMatrix = await createDistanceMatrix(services)

    if (!distanceMatrix) {
      console.error('Failed to calculate distance matrix')
      return NextResponse.json(
        { error: 'Failed to calculate distances' },
        { status: 500 },
      )
    }

    // Log distance statistics
    const flatDistances = distanceMatrix
      .flat()
      .filter(d => d !== null && d !== 0)
    console.log('Distance Statistics:')
    console.log(
      `  Min distance: ${(Math.min(...flatDistances) / MILES_TO_METERS).toFixed(3)} miles`,
    )
    console.log(
      `  Max distance: ${(Math.max(...flatDistances) / MILES_TO_METERS).toFixed(3)} miles`,
    )
    console.log(
      `  Average distance: ${(flatDistances.reduce((a, b) => a + b, 0) / flatDistances.length / MILES_TO_METERS).toFixed(3)} miles`,
    )

    console.log(`Clustering parameters:`)
    console.log(`  Max points per cluster: ${params.maxPoints}`)
    console.log(`  Min Points: ${params.minPoints}`)
    console.log(`  Number of services: ${services.length}`)

    const worker = new Worker(
      path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
    )

    const clusteredServices = await new Promise((resolve, reject) => {
      worker.on('message', resolve)
      worker.on('error', reject)
      worker.postMessage({
        services,
        distanceMatrix: distanceMatrix.map(row => [...row]),
        maxPointsPerCluster: params.maxPoints,
        minPoints: params.minPoints,
        clusterUnclustered: params.clusterUnclustered,
      })
    })

    worker.terminate()

    // Log clustering results
    console.log('Clustering Results:')
    const clusterCounts = clusteredServices.reduce((acc, service) => {
      acc[service.cluster] = (acc[service.cluster] || 0) + 1
      return acc
    }, {})
    console.log('  Cluster distribution:', clusterCounts)

    if (
      Object.keys(clusterCounts).length === 1 &&
      clusterCounts[-1] === undefined
    ) {
      console.warn(
        'Warning: Only one cluster was created. Consider adjusting the clustering parameters.',
      )
    }

    setCachedData(cacheKey, clusteredServices)
    return NextResponse.json(clusteredServices)
  } catch (error) {
    console.error('Error in cluster API:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
