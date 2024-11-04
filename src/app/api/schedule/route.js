import { getDefaultDateRange } from '@/app/utils/dates'
import axios from 'axios'
import { NextResponse } from 'next/server'
import { scheduleServices } from '../../scheduling/index.js'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const MIN_PROGRESS_INCREMENT = 0.01 // 1% minimum increment
const PROGRESS_UPDATE_INTERVAL = 100 // 100ms minimum between updates

async function fetchServices(start, end) {
  try {
    const response = await axios.get(`${BASE_URL}/api/services`, {
      params: { start, end },
    })
    console.log(`Fetched ${response.data.length} services from API`)
    return response.data
  } catch (error) {
    console.error('Error fetching services:', error)
    throw new Error(`Failed to fetch services: ${error.message}`)
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const defaultRange = getDefaultDateRange()
  const start = searchParams.get('start') || defaultRange.start
  const end = searchParams.get('end') || defaultRange.end

  const encoder = new TextEncoder()

  try {
    const services = await fetchServices(start, end)
    console.log(`Fetched ${services.length} services for scheduling`)

    const stream = new ReadableStream({
      async start(controller) {
        let lastProgress = 0
        let lastUpdateTime = Date.now()

        for await (const result of scheduleServices(services)) {
          if (result.type === 'progress') {
            const currentTime = Date.now()
            const timeDiff = currentTime - lastUpdateTime
            const progressDiff = result.data - lastProgress

            // Only send progress if enough time has passed AND progress is significant
            if (
              timeDiff >= PROGRESS_UPDATE_INTERVAL &&
              progressDiff >= MIN_PROGRESS_INCREMENT
            ) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'progress',
                    data: Math.floor(result.data * 100) / 100,
                  })}\n\n`,
                ),
              )
              lastProgress = result.data
              lastUpdateTime = currentTime
            }
          } else if (result.type === 'complete') {
            const { assignedServices, unassignedServices, resources } =
              result.data
            console.log(`Scheduled services: ${assignedServices.length}`)

            // Group unassigned services by reason
            const unassignedGroups = unassignedServices.reduce(
              (acc, service) => {
                acc[service.reason] = (acc[service.reason] || 0) + 1
                return acc
              },
              {},
            )

            // Create summary messages for unassigned services
            const unassignedSummaries = Object.entries(unassignedGroups).map(
              ([reason, count]) =>
                `${count} services unassigned. Reason: ${reason}`,
            )

            console.log('Unassigned services summary:')
            for (const summary of unassignedSummaries) {
              console.log(summary)
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  data: {
                    assignedServices,
                    unassignedServices: unassignedSummaries,
                    resources,
                  },
                })}\n\n`,
              ),
            )
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error fetching services:', error)
    return NextResponse.json(
      { error: 'Failed to fetch services' },
      { status: 500 },
    )
  }
}
