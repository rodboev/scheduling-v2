import { NextResponse } from 'next/server'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import axios from 'axios'
import { createDistanceMatrix } from '@/app/utils/distance'
import { startOfDay, endOfDay, dayjsInstance } from '@/app/utils/dayjs'

export async function GET(request) {
  const params = Object.fromEntries(request.nextUrl.searchParams)
  console.log('Schedule API called with params:', params)

  try {
    // Use the exact dates from the request
    const start = dayjsInstance(params.start)
    const end = dayjsInstance(params.end)

    console.log('Date range:', {
      requestedStart: params.start,
      requestedEnd: params.end,
      normalizedStart: start.format(),
      normalizedEnd: end.format(),
    })

    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: params.start,
        end: params.end,
      },
    })

    console.log(
      'Services API response:',
      JSON.stringify(
        {
          count: response.data.length,
          dateRange: response.data.map(s => s.date),
        },
        null,
        2,
      ),
    )

    const services = response.data.filter(service => {
      if (!service.time.range[0] || !service.time.range[1]) return false

      const serviceDate = dayjsInstance(service.date)
      // Check if service is within the requested range
      const isInRange = serviceDate.isBetween(start, end, null, '[)')

      if (!isInRange) {
        console.log(
          'Service outside range:',
          JSON.stringify(
            {
              serviceDate: service.date,
              start: start.format(),
              end: end.format(),
            },
            null,
            2,
          ),
        )
      }

      return isInRange
    })

    console.log(
      'Filtered services:',
      JSON.stringify(
        {
          count: services.length,
          dates: services.map(s => s.date),
        },
        null,
        2,
      ),
    )

    if (!services.length) {
      console.log('No services found')
      return new Response(
        JSON.stringify(
          {
            scheduledServices: [],
            unassignedServices: [],
          },
          null,
          2,
        ),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        },
      )
    }

    // Create distance matrix in parallel with worker initialization
    const distanceMatrixPromise = createDistanceMatrix(services)
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))

    const distanceMatrix = await distanceMatrixPromise
    if (!Array.isArray(distanceMatrix) || distanceMatrix.length === 0) {
      console.warn('Invalid distance matrix')
      const result = {
        scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
        unassignedServices: [],
      }
      console.log(
        'Returning unscheduled services:',
        JSON.stringify(
          {
            count: result.scheduledServices.length,
            sample: result.scheduledServices[0],
          },
          null,
          2,
        ),
      )
      return new Response(JSON.stringify(result, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
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
        resolve(result)
      })

      worker.on('error', error => {
        clearTimeout(timeout)
        worker.terminate()
        reject(error)
      })

      worker.postMessage({ services, distanceMatrix })
    })

    console.log(
      'Worker result:',
      JSON.stringify(
        {
          scheduledCount: result.scheduledServices?.length,
          unassignedCount: result.unassignedServices?.length,
          sample: result.scheduledServices?.[0],
        },
        null,
        2,
      ),
    )

    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
  } catch (error) {
    console.error('Scheduling API error:', error)
    return new Response(
      JSON.stringify(
        {
          error: 'Internal Server Error',
          details: error.message,
          scheduledServices: [],
          unassignedServices: [],
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
