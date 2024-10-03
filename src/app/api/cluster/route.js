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
      minPoints: parseInt(searchParams.get('minPoints'), 10) || 1,
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

    const worker = new Worker(
      path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
    )

    const { clusteredServices, clusteringInfo } = await new Promise(
      (resolve, reject) => {
        worker.on('message', resolve)
        worker.on('error', reject)
        worker.postMessage({
          services,
          distanceMatrix,
          maxPoints: params.maxPoints,
          minPoints: params.minPoints,
          clusterUnclustered: params.clusterUnclustered,
          algorithm: params.algorithm,
        })
      },
    )

    worker.terminate()

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

    // Log clustering results
    console.log(`Results from clustering (${clusteringInfo.algorithm}):`)
    if (clusteringInfo.algorithm === 'K-means') {
      console.log(`  Used k: ${clusteringInfo.k}`)
      console.log(`  Number of clusters: ${clusteringInfo.clusterSizes.length}`)
      clusteringInfo.clusterSizes.forEach((size, index) => {
        console.log(`  Cluster ${index}: ${size} points`)
      })
    }

    const clusterCounts = clusteredServices.reduce((acc, service) => {
      acc[service.cluster] = (acc[service.cluster] || 0) + 1
      return acc
    }, {})
    console.log('  Cluster distribution:', clusterCounts)

    const totalClusters = Object.keys(clusterCounts).filter(
      k => k !== '-1' && k !== '-2',
    ).length
    console.log(
      `  Total clusters: ${totalClusters}, Noise points: ${clusterCounts['-1'] || 0}, Outliers: ${clusterCounts['-2'] || 0}`,
    )

    // Log outliers
    const outliers = clusteredServices.filter(service => service.cluster === -2)
    if (outliers.length > 0) {
      outliers.forEach(service => {
        console.log(
          `    ${service.company}: [${service.location.latitude}, ${service.location.longitude}]`,
        )
      })
    }

    if (totalClusters === 1 && !clusterCounts['-1'] && !clusterCounts['-2']) {
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
