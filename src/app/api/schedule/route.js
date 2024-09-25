import axios from 'axios'
import { NextResponse } from 'next/server'
import { scheduleServices } from '../../scheduling/index.js'

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

  const stream = new ReadableStream({
    async start(controller) {
      try {
        console.log('Fetching services...')
        const servicesResponse = await axios.get(
          `http://localhost:${process.env.PORT}/api/services`,
          {
            params: { start, end },
          },
        )
        const services = servicesResponse.data

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
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'result', scheduledServices, unassignedServices })}\n\n`,
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
}
