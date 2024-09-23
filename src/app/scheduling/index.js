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

export function calcDistance(coords1, coords2) {
  const toRadians = degrees => degrees * (Math.PI / 180)

  const { latitude: lat1, longitude: lon1 } = coords1
  const { latitude: lat2, longitude: lon2 } = coords2

  const R = 3958.8 // Radius of the Earth in miles
  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c // Distance in miles
}
