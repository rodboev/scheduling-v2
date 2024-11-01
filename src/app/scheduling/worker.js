import { parentPort, workerData } from 'node:worker_threads'
import { closeRedisConnection } from '../utils/redisClient.js'
import { scheduleService, scheduleEnforcedService } from './scheduler.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
} from './servicePrep.js'

async function runScheduling() {
  try {
    const { services } = workerData

    console.log(`Total services received: ${services.length}`)

    console.time('Total scheduling time')

    const invalidServices = filterInvalidServices(services)
    console.log(`Invalid services: ${invalidServices.length}`)

    const servicesToSchedule = prepareServicesToSchedule(services)
    console.log(`Services to schedule: ${servicesToSchedule.length}`)

    sortServices(servicesToSchedule)

    let processedCount = 0
    const techSchedules = {}
    const unassignedServices = []
    const unassignedReasons = {}

    for (const service of servicesToSchedule) {
      try {
        let result
        if (service.tech.enforced && service.tech.code) {
          result = await scheduleEnforcedService({
            service,
            techSchedules,
          })
        } else {
          result = await scheduleService({
            service,
            techSchedules,
            remainingServices: servicesToSchedule.slice(processedCount + 1),
          })
        }

        if (result.scheduled) {
          // No need to log each scheduled service
        } else {
          unassignedReasons[result.reason] = (unassignedReasons[result.reason] || 0) + 1
          unassignedServices.push({ ...service, reason: result.reason })
        }

        processedCount++
        const progress = processedCount / servicesToSchedule.length
        parentPort.postMessage({ type: 'progress', data: progress })
      } catch (error) {
        console.error(`Error scheduling service ${service.id}:`, error)
        unassignedServices.push({ ...service, reason: `Scheduling error: ${error.message}` })
      }
    }

    console.timeEnd('Total scheduling time')

    console.log('Scheduling completed')
    console.log(`Total services processed: ${processedCount}`)
    console.log('Tech schedules:', Object.keys(techSchedules).length)
    for (const [techId, schedule] of Object.entries(techSchedules)) {
      console.log(`  ${techId}: ${schedule.shifts.reduce((sum, shift) => sum + shift.services.length, 0)} services`)
    }
    console.log('Unassigned services summary:')
    for (const [reason, count] of Object.entries(unassignedReasons)) {
      console.log(`${count} services unassigned. Reason: ${reason}`)
    }
    console.log(`Invalid services: ${invalidServices.length}`)

    parentPort.postMessage({
      type: 'result',
      data: {
        techSchedules,
        unassignedServices: unassignedServices.concat(invalidServices),
      },
    })
  } catch (error) {
    console.error('Fatal error in scheduling process:', error)
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
    })
  } finally {
    await closeRedisConnection()
  }
}

runScheduling().catch(error => {
  console.error('Error in worker:', error)
  parentPort.postMessage({
    type: 'error',
    error: error.message,
    stack: error.stack,
  })
})