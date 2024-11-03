import axios from 'axios'
import { NextResponse } from 'next/server'
import { scheduleServices } from '../../scheduling/index.js'

async function fetchServices(start, end) {
  try {
    const response = await axios.get(
      `http://localhost:${process.env.PORT}/api/services`,
      {
        params: { start, end },
      },
    )
    return response.data
  } catch (error) {
    console.error('Error fetching services:', error)
    throw error
  }
}

export async function GET(request) {
  console.log('Schedule API route called')

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json(
      { error: 'Start and end dates are required' },
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()

  try {
    const services = await fetchServices(start, end)
    console.log(`Fetched ${services.length} services for scheduling`)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Scheduling services...')

          for await (const result of scheduleServices(services)) {
            if (result.type === 'progress') {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'progress', data: result.data })}\n\n`,
                ),
              )
            } else if (result.type === 'result') {
              const { scheduledServices, unassignedServices } = result.data
              console.log(`Scheduled services: ${scheduledServices.length}`)

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
                    type: 'result',
                    scheduledServices,
                    unassignedServices: unassignedSummaries,
                  })}\n\n`,
                ),
              )
            }
          }
        } catch (error) {
          console.error('Error in schedule route:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', error: error.message, stack: error.stack })}\n\n`,
            ),
          )
        } finally {
          controller.close()
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
