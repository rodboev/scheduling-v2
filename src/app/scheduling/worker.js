import { parentPort, workerData } from 'worker_threads'
import { printSummary } from './logging.js'
import { scheduleService, scheduleEnforcedService } from './schedulingLogic.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
  sortServicesByTimeAndProximity,
} from './servicePreparation.js'

async function runScheduling() {
  const { services } = workerData

  console.time('Total scheduling time')

  const invalidServices = filterInvalidServices(services)
  let servicesToSchedule = prepareServicesToSchedule(services)
  servicesToSchedule = sortServices(servicesToSchedule)

  const totalServices = servicesToSchedule.length
  console.log(`Total services to schedule: ${totalServices}`)

  let processedCount = 0
  const techSchedules = {}
  const unassignedServices = []

  // Group services by date
  const servicesByDate = groupServicesByDate(servicesToSchedule)

  // Schedule services for each date
  for (const [date, dateServices] of Object.entries(servicesByDate)) {
    let remainingServices = [...dateServices]

    while (remainingServices.length > 0) {
      const sortedServices = sortServicesByTimeAndProximity(
        remainingServices,
        0.5,
      ) // You can adjust the weight here
      const service = sortedServices[0]

      const result = scheduleService({
        service,
        techSchedules,
        remainingServices: sortedServices.slice(1),
      })

      if (result.scheduled && result.techId) {
        processedCount++
        // Remove all scheduled services from remainingServices
        remainingServices = remainingServices.filter(
          s =>
            !techSchedules[result.techId].shifts.some(shift =>
              shift.services.some(
                scheduledService => scheduledService.id === s.id,
              ),
            ),
        )
      } else {
        unassignedServices.push({
          ...service,
          reason: result.reason,
        })
        remainingServices = remainingServices.filter(s => s.id !== service.id)
      }

      if (processedCount % 10 === 0) {
        parentPort.postMessage({
          type: 'progress',
          progress: {
            processed: processedCount,
            total: totalServices,
          },
        })
      }
    }
  }

  console.timeEnd('Total scheduling time')

  console.log(`Scheduled ${processedCount} services`)
  console.log(`Unassigned services: ${unassignedServices.length}`)

  // Make sure we're sending both techSchedules and unassignedServices
  parentPort.postMessage({
    type: 'result',
    techSchedules,
    unassignedServices: unassignedServices.concat(invalidServices),
  })

  // Call printSummary here
  printSummary({
    techSchedules,
    unassignedServices: unassignedServices.concat(invalidServices),
  })
}

function groupServicesByDate(services) {
  const servicesByDate = {}
  for (const service of services) {
    const date = service.time.range[0].toISOString().split('T')[0]
    if (!servicesByDate[date]) {
      servicesByDate[date] = []
    }
    servicesByDate[date].push(service)
  }
  return servicesByDate
}

runScheduling().catch(error => {
  console.error('Error in worker:', error)
  parentPort.postMessage({
    type: 'error',
    error: error.message,
    stack: error.stack,
  })
})
