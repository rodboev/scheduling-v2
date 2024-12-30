import { parentPort, workerData } from 'node:worker_threads'
import { scheduleServices } from '../../scheduling/index.js'

async function processServices(services, distanceMatrix) {
  try {
    // Process all services at once
    let result = null
    for await (const update of scheduleServices(services)) {
      if (update.type === 'result') {
        result = update
        break
      }
    }

    if (!result) {
      throw new Error('No result from scheduling')
    }

    const { scheduledServices, unassignedServices } = result.data

    // Group services by tech and date
    const techDayGroups = {}
    for (const service of scheduledServices) {
      const date = new Date(service.start).toISOString().split('T')[0]
      const techId = service.resourceId
      const shift = getShiftForTime(service.start)
      const key = `${techId}_${date}_${shift}`

      if (!techDayGroups[key]) {
        techDayGroups[key] = []
      }
      techDayGroups[key].push(service)
    }

    // Assign cluster numbers and sequence numbers
    let clusterNum = 0
    const processedServices = []

    for (const [key, services] of Object.entries(techDayGroups)) {
      // Sort services by start time within each group
      services.sort((a, b) => new Date(a.start) - new Date(b.start))

      // Assign cluster and sequence numbers
      for (let i = 0; i < services.length; i++) {
        const service = services[i]
        service.cluster = clusterNum
        service.sequenceNumber = i + 1

        // Get distance from previous service in cluster
        if (i > 0) {
          const prevService = services[i - 1]
          const distance = distanceMatrix[prevService.id]?.[service.id]
          if (distance !== undefined) {
            service.distanceFromPrevious = distance
            service.previousCompany = prevService.company
          }
        }

        processedServices.push(service)
      }
      clusterNum++
    }

    // Group unassigned services by reason
    const unassignedGroups = unassignedServices.reduce((acc, service) => {
      acc[service.reason] = (acc[service.reason] || 0) + 1
      return acc
    }, {})

    // Create summary messages for unassigned services
    const unassignedSummaries = Object.entries(unassignedGroups).map(
      ([reason, count]) => `${count} services unassigned. Reason: ${reason}`,
    )

    return {
      scheduledServices: processedServices,
      unassignedServices: unassignedSummaries,
      performanceDuration: result.performanceDuration || 0,
    }
  } catch (error) {
    console.error('Error in worker:', error)
    throw error
  }
}

function getShiftForTime(time) {
  const hour = new Date(time).getUTCHours()
  if (hour >= 8 && hour < 16) return 1
  if (hour >= 16) return 2
  return 3
}

// Handle messages from the main thread
parentPort.on('message', async ({ services, distanceMatrix }) => {
  try {
    const result = await processServices(services, distanceMatrix)
    parentPort.postMessage(result)
  } catch (error) {
    console.error('Worker error:', error)
    parentPort.postMessage({
      error: error.message,
      scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
    })
  }
})
