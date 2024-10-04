import { createDistanceMatrix } from '@/app/utils/distance'
import { getCachedData, setCachedData } from '@/app/utils/redisClient'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'

const LOG_MATRIX = false

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const params = {
      start: searchParams.get('start'),
      end: searchParams.get('end'),
      clusterUnclustered: searchParams.get('clusterUnclustered') === 'true',
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
          clusterUnclustered: params.clusterUnclustered,
          algorithm: params.algorithm,
        })
      },
    )

    worker.terminate()

    // Log clustering results
    console.log(
      `Results from clustering (${clusteringInfo.algorithm}${
        clusteringInfo.algorithm === 'K-means'
          ? `, k = ${clusteringInfo.k}`
          : ''
      }):`,
    )
    console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)
    console.log(
      `Performance duration: ${clusteringInfo.performanceDuration} ms`,
    )

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
    console.error('Error in cluster API:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
