import { printSummary } from './logging.js'
import { scheduleService, scheduleEnforcedService } from './schedulingLogic.js'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
} from './servicePreparation.js'
import { flattenServices } from './shiftManagement.js'

export const MAX_SHIFT_HOURS = 8
export const MIN_REST_HOURS = 15
export const MAX_SHIFT_GAP = MIN_REST_HOURS

export async function scheduleServices({ services, onProgress }) {
  console.time('Total time')
  console.time('Total scheduling time')

  const scheduledServiceIdsByDate = new Map()
  const unassignedServices = filterInvalidServices(services)
  const servicesToSchedule = prepareServicesToSchedule(services)

  console.time('Sorting services')
  sortServices(servicesToSchedule)
  console.timeEnd('Sorting services')

  const techSchedules = {
    // techId: {
    //   shifts: [
    //     {
    //       shiftStart: dayjs,
    //       shiftEnd: dayjs,
    //       services: []
    //     }
    //   ]
    // }
  }
  let nextGenericTechId = 1

  const totalServices = servicesToSchedule.length

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

  for (const [serviceIndex, service] of servicesToSchedule.entries()) {
    let result
    if (service.tech.enforced && service.tech.code) {
      result = scheduleEnforcedService({
        service,
        techSchedules,
        scheduledServiceIdsByDate,
      })
    } else {
      // Main scheduling loop for non-enforced services
      result = scheduleService({
        service,
        techSchedules,
        scheduledServiceIdsByDate,
        nextGenericTechId,
        remainingServices: servicesToSchedule.slice(serviceIndex + 1),
      })
    }

    if (!result.scheduled) {
      unassignedServices.push({
        ...service,
        reason: result.reason,
      })
    } else {
      // If we scheduled the service, increment the next generic tech id
      nextGenericTechId = getNextGenericTechId(techSchedules)
    }

    const progress = Math.round((serviceIndex / totalServices) * 100)
    onProgress(progress)

    if (serviceIndex % 10 === 0) await delay(0)
  }

  console.timeEnd('Total scheduling time')
  printSummary({ techSchedules, unassignedServices })
  console.timeEnd('Total time')

  return {
    scheduledServices: flattenServices(techSchedules),
    unassignedServices,
  }
}

function getNextGenericTechId(techSchedules) {
  return (
    Math.max(
      ...Object.keys(techSchedules).map(id => parseInt(id.split(' ')[1])),
    ) + 1
  )
}
