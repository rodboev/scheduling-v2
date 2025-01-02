import { NextResponse } from 'next/server'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import axios from 'axios'
import { createDistanceMatrix } from '@/app/utils/distance'

export async function GET(request) {
  const params = Object.fromEntries(request.nextUrl.searchParams)
  console.log('Cluster Single API called with params:', params)

  try {
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: params.start,
        end: params.end,
      },
    })

    console.log('Services API response:', {
      count: response.data.length,
      sample: response.data[0],
    })

    const services = response.data.filter(
      service => service.time.range[0] !== null && service.time.range[1] !== null,
    )

    console.log('Filtered services:', {
      count: services.length,
      sample: services[0],
    })

    if (!services.length) {
      console.log('No services found')
      return new Response(
        JSON.stringify(
          {
            clusteredServices: [],
          },
          null,
          2,
        ),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/cluster-single/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      const result = {
        clusteredServices: services.map(service => ({ ...service, cluster: -1 })),
      }
      console.log('Returning unclustered services:', {
        count: result.clusteredServices.length,
        sample: result.clusteredServices[0],
      })
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timed out'))
      }, 30000)

      worker.on('message', result => {
        clearTimeout(timeout)
        worker.terminate()
        try {
          const parsedResult = typeof result === 'string' ? JSON.parse(result) : result
          resolve(parsedResult)
        } catch (error) {
          reject(new Error('Invalid worker result structure'))
        }
      })

      worker.on('error', error => {
        clearTimeout(timeout)
        worker.terminate()
        reject(error)
      })

      worker.postMessage({ services, distanceMatrix })
    })

    console.log('Worker result:', {
      clusteredCount: result.clusteredServices?.length,
      sample: result.clusteredServices?.[0],
      clusterInfo: result.clusteringInfo,
    })

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Clustering API error:', error)
    return new Response(
      JSON.stringify(
        {
          error: 'Internal Server Error',
          details: error.message,
          clusteredServices: [],
        },
        null,
        2,
      ),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
