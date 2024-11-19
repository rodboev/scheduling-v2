import axios from 'axios'
import { NextResponse } from 'next/server'
import { scheduleServices } from '../../scheduling/index.js'

async function fetchServices(start, end) {
  try {
    // First fetch the clustered services
    const clusterResponse = await axios.get(
      `http://localhost:${process.env.PORT}/api/cluster-single`,
      {
        params: { start, end },
      },
    )
    
    // Return the clustered services
    return clusterResponse.data.clusteredServices
  } catch (error) {
    console.error('Error fetching clustered services:', error)
    throw error
  }
}

export async function GET(request) {
  console.log('Clustered Schedule API route called')

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') || '2024-09-03T02:30:00.000Z'
  const end = searchParams.get('end') || '2024-09-03T12:30:00.999Z'

  const encoder = new TextEncoder()

  try {
    const services = await fetchServices(start, end)
    console.log(`Fetched ${services.length} clustered services for scheduling`)

    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log('Scheduling clustered services...')

          for await (const result of scheduleServices(services)) {
            if (result.type === 'progress') {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'progress', data: result.data })}\n\n`,
                ),
              )
            } else if (result.type === 'result') {
              const { scheduledServices, unassignedServices } = result.data
              console.log(`Scheduled clustered services: ${scheduledServices.length}`)

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
          console.error('Error in clustered schedule route:', error)
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
    console.error('Error fetching clustered services:', error)
    return NextResponse.json(
      { error: 'Failed to fetch clustered services' },
      { status: 500 },
    )
  }
} 