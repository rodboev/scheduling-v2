import { scheduleServices } from '@/app/scheduling'
import axios from 'axios'
import { NextResponse } from 'next/server'

export async function GET(request) {
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
        console.log('Services fetched:', services.length)
        console.log(
          'Enforced services:',
          services.filter(s => s.tech.enforced).length,
        )

        console.log('Scheduling services...')
        for await (const result of scheduleServices(services)) {
          if (result.type === 'progress') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ progress: result.data })}\n\n`,
              ),
            )
          } else if (result.type === 'result') {
            const { scheduledServices, unassignedServices } = result.data
            console.log(
              'Scheduled services:',
              scheduledServices.length,
              'Unassigned:',
              unassignedServices.length,
            )
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ scheduledServices, unassignedServices })}\n\n`,
              ),
            )
          }
        }
      } catch (error) {
        console.error('Error in schedule route:', error)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: error.message, stack: error.stack })}\n\n`,
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
