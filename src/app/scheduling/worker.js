import { parentPort, workerData } from 'worker_threads'
import { scheduleServices } from './index.js'

async function runScheduling() {
  try {
    const { services } = workerData

    const { scheduledServices, unassignedServices } = await scheduleServices({
      services,
      onProgress: progress => {
        parentPort.postMessage({ type: 'progress', progress })
      },
    })

    parentPort.postMessage({
      type: 'result',
      data: { scheduledServices, unassignedServices },
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
    })
  }
}

runScheduling()
