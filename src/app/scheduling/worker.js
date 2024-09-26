import { parentPort, workerData } from 'worker_threads'
import { scheduleService, scheduleEnforcedService } from './scheduler.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
} from './servicePrep.js'

async function runScheduling() {
  const { services } = workerData

  console.time('Total scheduling time')

  const invalidServices = filterInvalidServices(services)
  const servicesToSchedule = prepareServicesToSchedule(services)
  sortServices(servicesToSchedule)

  const totalServices = servicesToSchedule.length
  console.log(`Total services to schedule: ${totalServices}`)

  let processedCount = 0
  const techSchedules = {}
  const unassignedServices = []

  for (const service of servicesToSchedule) {
    let result
    if (service.tech.enforced && service.tech.code) {
      result = scheduleEnforcedService({
        service,
        techSchedules,
      })
    } else {
      result = scheduleService({
        service,
        techSchedules,
        remainingServices: servicesToSchedule.slice(processedCount + 1),
      })
    }

    if (!result.scheduled) {
      unassignedServices.push({ ...service, reason: result.reason })
    }

    processedCount++
    const progress = processedCount / totalServices
    parentPort.postMessage({ type: 'progress', data: progress })
  }

  console.timeEnd('Total scheduling time')

  console.log(`Scheduling completed`)
  console.log(`Total services processed: ${processedCount}`)
  console.log(
    `Scheduled services: ${processedCount - unassignedServices.length}`,
  )
  console.log(`Unassigned services: ${unassignedServices.length}`)
  console.log(`Invalid services: ${invalidServices.length}`)

  parentPort.postMessage({
    type: 'result',
    data: {
      techSchedules,
      unassignedServices: unassignedServices.concat(invalidServices),
    },
  })
}

runScheduling().catch(error => {
  console.error('Error in worker:', error)
  parentPort.postMessage({
    type: 'error',
    error: error.message,
    stack: error.stack,
  })
})
