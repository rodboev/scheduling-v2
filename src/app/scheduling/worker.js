import { parentPort, workerData } from 'worker_threads'
import { scheduleServices } from './index.js'

async function runScheduling() {
  try {
    const { services } = workerData

    const result = await scheduleServices({
      services,
      onProgress: progress => {
        parentPort.postMessage({ type: 'progress', progress })
      },
    })

    parentPort.postMessage({
      type: 'result',
      data: result,
    })

    console.log(`Worker processed ${services.length} services`)
  } catch (error) {
    console.error(`Error in worker:`, error)
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
    })
  }
}

runScheduling()
