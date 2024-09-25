import { parentPort, workerData } from 'worker_threads'
import { scheduleService, scheduleEnforcedService } from './schedulingLogic.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServicesByTime,
} from './servicePreparation.js'

async function runScheduling() {
  const { services } = workerData

  const startTime = performance.now()
  console.time('Total scheduling time')

  const invalidServices = filterInvalidServices(services)
  let servicesToSchedule = prepareServicesToSchedule(services)
  servicesToSchedule = sortServicesByTime(servicesToSchedule)

  const totalServices = services.length
  console.log(`Total services:`, totalServices)

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
    if (processedCount % 10 === 0) {
      const progress = processedCount / totalServices
      parentPort.postMessage({ type: 'progress', progress })
    }
  }

  // // Schedule enforced services first
  // const enforcedServices = servicesToSchedule.filter(
  //   s => s.tech && s.tech.enforced,
  // )
  // for (const service of enforcedServices) {
  //   scheduleEnforcedService({ service, techSchedules })
  //   processedCount++
  //   updateProgress()
  // }

  // // Remove enforced services from servicesToSchedule
  // servicesToSchedule = servicesToSchedule.filter(
  //   s => !s.tech || !s.tech.enforced,
  // )

  // // Schedule remaining services
  // while (servicesToSchedule.length > 0) {
  //   const sortedServices = sortServicesByTime(servicesToSchedule, 0.5)
  //   const service = sortedServices[0]

  //   const result = scheduleService({
  //     service,
  //     techSchedules,
  //     remainingServices: sortedServices.slice(1),
  //   })

  //   processedCount++
  //   if (processedCount % 10 === 0) {
  //     updateProgress()
  //   }

  //   if (result.scheduled && result.techId) {
  //     servicesToSchedule = servicesToSchedule.filter(
  //       s =>
  //         !techSchedules[result.techId].shifts.some(shift =>
  //           shift.services.some(
  //             scheduledService => scheduledService.id === s.id,
  //           ),
  //         ),
  //     )
  //   } else {
  //     unassignedServices.push({
  //       ...service,
  //       reason: result.reason,
  //     })
  //     servicesToSchedule = servicesToSchedule.filter(s => s.id !== service.id)
  //   }
  // }

  const endTime = performance.now()
  console.timeEnd('Total scheduling time')

  const scheduledCount = Object.values(techSchedules).reduce(
    (total, tech) =>
      total +
      tech.shifts.reduce(
        (shiftTotal, shift) => shiftTotal + shift.services.length,
        0,
      ),
    0,
  )

  const schedulingStats = {
    totalServices,
    processedCount,
    scheduledCount,
    unassignedCount: unassignedServices.length,
    invalidCount: invalidServices.length,
    totalTime: endTime - startTime,
  }

  console.log(`Scheduling completed`)
  console.log(`Total services:`, schedulingStats.totalServices)
  console.log(`Processed services:`, schedulingStats.processedCount)
  console.log(`Scheduled services:`, schedulingStats.scheduledCount)
  console.log(`Unassigned services:`, schedulingStats.unassignedCount)
  console.log(`Invalid services:`, schedulingStats.invalidCount)

  parentPort.postMessage({
    type: 'result',
    techSchedules,
    unassignedServices: unassignedServices.concat(invalidServices),
    schedulingStats,
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
