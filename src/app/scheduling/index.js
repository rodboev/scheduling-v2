import path from 'path'
import { Worker } from 'worker_threads'
import { printSummary } from './logging.js'

export const MAX_SHIFT_HOURS = 8
export const MIN_REST_HOURS = 15
export const MAX_SHIFT_GAP = MIN_REST_HOURS

export async function* scheduleServices(services) {
  const workerPath = path.resolve(process.cwd(), 'src/app/scheduling/worker.js')
  const worker = new Worker(workerPath, { workerData: { services } })

  try {
    while (true) {
      const message = await new Promise((resolve, reject) => {
        worker.once('message', resolve)
        worker.once('error', reject)
      })

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
          type: 'result',
          data: { scheduledServices, unassignedServices },
        }
        break
      } else if (message.type === 'progress') {
        yield { type: 'progress', data: message.progress }
      }
    }
  } finally {
    worker.terminate()
  }
}
