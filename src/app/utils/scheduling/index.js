import { printSummary } from '@/app/utils/scheduling/logging'
import {
  scheduleService,
  scheduleEnforcedService,
} from '@/app/utils/scheduling/schedulingLogic'
import {
  filterInvalidServices,
  prepareServicesToSchedule,
  sortServices,
} from '@/app/utils/scheduling/servicePreparation'
import { flattenServices } from '@/app/utils/scheduling/shiftManagement'

export const MAX_SHIFT_HOURS = 8
export const MIN_REST_HOURS = 16
export const MAX_SHIFT_GAP = MIN_REST_HOURS

export async function scheduleServices({ services, onProgress }) {
  console.time('Total time')
  console.time('Total scheduling time')

  const scheduledServiceIdsByDate = new Map()
  const unscheduledServices = filterInvalidServices(services)
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
    let scheduled = false
    if (service.tech.enforced && service.tech.code) {
      scheduled = scheduleEnforcedService({
        service,
        techSchedules,
        scheduledServiceIdsByDate,
      })
    } else {
      // Main scheduling loop for non-enforced services
      scheduled = scheduleService({
        service,
        techSchedules,
        scheduledServiceIdsByDate,
        nextGenericTechId,
        remainingServices: servicesToSchedule.slice(serviceIndex + 1),
      })
      if (!scheduled) {
        unscheduledServices.push(service)
      }
    }
    const progress = Math.round((serviceIndex / totalServices) * 100)
    onProgress(progress)

    // If we scheduled the service, increment the next generic tech id
    if (scheduled) nextGenericTechId = getNextGenericTechId(techSchedules)

    if (serviceIndex % 10 === 0) await delay(0)
  }

  console.timeEnd('Total scheduling time')
  printSummary({ techSchedules, unscheduledServices })
  console.timeEnd('Total time')

  return {
    scheduledServices: flattenServices(techSchedules),
    unscheduledServices,
  }
}

function getNextGenericTechId(techSchedules) {
  return (
    Math.max(
      ...Object.keys(techSchedules).map(id => parseInt(id.split(' ')[1])),
    ) + 1
  )
}
