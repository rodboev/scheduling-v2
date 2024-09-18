import axios from 'axios'
import { NextResponse } from 'next/server'
import path from 'path'
import { Worker } from 'worker_threads'
import { printSummary } from '../../scheduling/logging.js'

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
        const workerPath = path.resolve(
          process.cwd(),
          'src/app/scheduling/worker.js',
        )
        const worker = new Worker(workerPath, {
          workerData: { services },
        })

        worker.on('message', message => {
          if (message.type === 'progress') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ progress: message.progress })}\n\n`,
              ),
            )
          } else if (message.type === 'result') {
            const { techSchedules, unassignedServices } = message.data
            console.log('Printing summary...')
            printSummary({ techSchedules, unassignedServices })

            const scheduledServices = Object.entries(techSchedules).flatMap(
              ([techId, schedule]) =>
                schedule.shifts.flatMap(shift =>
                  shift.services.map(service => ({
                    ...service,
                    resourceId: techId,
                  })),
                ),
            )

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ scheduledServices, unassignedServices })}\n\n`,
              ),
            )
            controller.close()
          }
        })

        worker.on('error', error => {
          console.error('Error in worker:', error)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error.message, stack: error.stack })}\n\n`,
            ),
          )
          controller.close()
        })

        worker.on('exit', code => {
          if (code !== 0) {
            console.error(`Worker stopped with exit code ${code}`)
          }
        })
      } catch (error) {
        console.error('Error in schedule route:', error)
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: error.message, stack: error.stack })}\n\n`,
          ),
        )
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
