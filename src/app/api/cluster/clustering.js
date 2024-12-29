import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function clusterServices(services, distanceMatrix) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'))

    worker.on('message', result => {
      if (result.error) {
        reject(new Error(result.error))
      } else {
        resolve(result)
      }
      worker.terminate()
    })

    worker.on('error', error => {
      reject(error)
      worker.terminate()
    })

    worker.postMessage({ services, distanceMatrix })
  })
}
