// /src/app/scheduling/index.js
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { printSummary } from './logging.js'

export const MAX_SHIFT_HOURS = 8
export const MIN_REST_HOURS = 15
export const MAX_SHIFT_GAP = MIN_REST_HOURS

export async function* scheduleServices(services, dateRange) {
  if (!services?.length) {
    throw new Error('No services provided for scheduling')
  }

  const workerPath = path.join(
    process.cwd(),
    'src',
    'app',
    'scheduling',
    'worker.js',
  )
  const worker = new Worker(workerPath, {
    workerData: { services, dateRange },
  })

  try {
    while (true) {
      const message = await new Promise((resolve, reject) => {
        worker.once('message', resolve)
        worker.once('error', reject)
      })

      if (message.type === 'progress') {
        yield { type: 'progress', data: message.data }
        continue
      }

      if (message.type === 'result') {
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

        yield {
          type: 'complete',
          data: {
            assignedServices: scheduledServices,
            unassignedServices,
            resources: Object.keys(techSchedules).map(id => ({
              id,
              title: id,
            })),
          },
        }
        break
      }
    }
  } finally {
    worker.terminate()
  }
}
