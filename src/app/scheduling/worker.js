import { parentPort, workerData } from 'worker_threads'
import { scheduleService, scheduleEnforcedService } from './schedulingLogic.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
  sortServicesByTimeAndProximity,
} from './servicePreparation.js'

async function runScheduling() {
  const { services } = workerData

  const startTime = performance.now()
  console.time('Total scheduling time')

  const invalidServices = filterInvalidServices(services)
  let servicesToSchedule = prepareServicesToSchedule(services)
  servicesToSchedule = sortServices(servicesToSchedule)

  const totalServices = services.length
  console.log(`Total services:`, totalServices)

  let processedCount = 0
  const techSchedules = {}
  const unassignedServices = []

  function updateProgress() {
    parentPort.postMessage({
      type: 'progress',
      progress: processedCount / totalServices,
    })
  }

  // Schedule enforced services first
  const enforcedServices = servicesToSchedule.filter(
    s => s.tech && s.tech.enforced,
  )
  for (const service of enforcedServices) {
    scheduleEnforcedService({ service, techSchedules })
    processedCount++
    updateProgress()
  }

  // Remove enforced services from servicesToSchedule
  servicesToSchedule = servicesToSchedule.filter(
    s => !s.tech || !s.tech.enforced,
  )

  // Group remaining services by date
  const servicesByDate = groupServicesByDate(servicesToSchedule)

  // Schedule remaining services for each date
  for (const [date, dateServices] of Object.entries(servicesByDate)) {
    let remainingServices = [...dateServices]

    while (remainingServices.length > 0) {
      const sortedServices = sortServicesByTimeAndProximity(
        remainingServices,
        0.5,
      )
      const service = sortedServices[0]

      const result = scheduleService({
        service,
        techSchedules,
        remainingServices: sortedServices.slice(1),
      })

      processedCount++
      updateProgress()

      if (result.scheduled && result.techId) {
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
    }
  }

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
    enforcedServices: enforcedServices.length,
  }

  console.log(`Scheduling completed`)
  console.log(`Total services:`, schedulingStats.totalServices)
  console.log(`Processed services:`, schedulingStats.processedCount)
  console.log(`Scheduled services:`, schedulingStats.scheduledCount)
  console.log(`Unassigned services:`, schedulingStats.unassignedCount)
  console.log(`Invalid services:`, schedulingStats.invalidCount)
  console.log(`Enforced services:`, schedulingStats.enforcedServices)

  parentPort.postMessage({
    type: 'result',
    techSchedules,
    unassignedServices: unassignedServices.concat(invalidServices),
    schedulingStats,
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
