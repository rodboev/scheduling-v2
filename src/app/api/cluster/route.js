import { calculateDistancesForShift } from '@/app/scheduling/distance'
import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'

const MILES_TO_METERS = 1609.34

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')
    const clusterUnclustered = searchParams.get('clusterUnclustered') === 'true'

    if (!start || !end) {
      return NextResponse.json(
        { error: 'Missing start or end date' },
        { status: 400 },
      )
    }

    const servicesResponse = await axios.get(
      `http://localhost:${process.env.PORT}/api/services`,
      {
        params: { start, end },
      },
    )

    // Filter services to include only those in New York, NY
    const services = servicesResponse.data.filter(service =>
      service.location.address2.includes('New York, NY'),
    )

    const distanceMatrix = await calculateDistancesForShift({ services })

    if (!distanceMatrix) {
      console.error('Failed to calculate distance matrix')
      return NextResponse.json(
        { error: 'Failed to calculate distances' },
        { status: 500 },
      )
    }

    // Log some statistics about the distance matrix
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

    const maxPointsPerCluster = 12
    const minPoints = 6

    console.log(`Clustering parameters:`)
    console.log(`  Max points per cluster: ${maxPointsPerCluster}`)
    console.log(`  Min Points: ${minPoints}`)
    console.log(`  Number of services: ${services.length}`)

    // Log a sample of services
    console.log('Sample of services:')
    services.slice(0, 5).forEach(service => {
      console.log(
        `  ${service.id}: ${service.location.latitude}, ${service.location.longitude}`,
      )
    })

    // Use worker thread for clustering
    const worker = new Worker(
      path.resolve(process.cwd(), 'src/app/api/cluster/worker.js'),
    )

    const clusteredServices = await new Promise((resolve, reject) => {
      worker.on('message', resolve)
      worker.on('error', reject)
      worker.postMessage({
        services,
        distanceMatrix: distanceMatrix.map(row => [...row]), // Create a copy of the distance matrix
        maxPointsPerCluster,
        minPoints,
        clusterUnclustered,
      })
    })

    worker.terminate()

    // Log the clustering results
    console.log('Clustering Results:')
    const clusterCounts = clusteredServices.reduce((acc, service) => {
      acc[service.cluster] = (acc[service.cluster] || 0) + 1
      return acc
    }, {})
    console.log('  Cluster distribution:', clusterCounts)

    // Check if only one cluster was created
    if (
      Object.keys(clusterCounts).length === 1 &&
      clusterCounts[-1] === undefined
    ) {
      console.warn(
        'Warning: Only one cluster was created. Consider adjusting the clustering parameters.',
      )
    }

    return NextResponse.json(clusteredServices)
  } catch (error) {
    console.error('Error in cluster API:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
