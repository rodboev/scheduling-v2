import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

// Format service time for logging
export const formatServiceTime = service => {
  const start = new Date(service.start)
  const end = new Date(service.end)
  const date = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  const startTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const endTime = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const rangeStart = new Date(service.time.range[0])
  const rangeEnd = new Date(service.time.range[1])
  const rangeStartTime = rangeStart.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const rangeEndTime = rangeEnd.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `(${service.sequenceNumber || '?'}) ${date} ${startTime}-${endTime}, ${service.company} (${service.location.latitude}, ${service.location.longitude}) (range: ${rangeStartTime}-${rangeEndTime})`
}

export function logClusterServices(clusterServices) {
  const firstService = clusterServices[0]
  const lastService = clusterServices[clusterServices.length - 1]
  const startTime = new Date(firstService.start).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const endTime = new Date(lastService.end).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  console.log(`Cluster ${firstService.cluster} (${startTime} - ${endTime}):`)

  // Log cluster services
  for (const [i, service] of clusterServices.entries()) {
    const distance = service.distanceFromPrevious || 0
    const travelTime = service.travelTimeFromPrevious || 0

    let line = formatServiceTime(service)
    if (i > 0) {
      line += ` (${distance.toFixed(2)} mi / ${travelTime} min from ${service.previousCompany})`
    }
    console.log(line)
  }

  // Print cluster stats
  const distances = clusterServices
    .filter(s => s.distanceFromPrevious !== undefined)
    .map(s => s.distanceFromPrevious)

  const travelTimes = clusterServices
    .filter(s => s.travelTimeFromPrevious !== undefined)
    .map(s => s.travelTimeFromPrevious)

  const totalDistance = distances.length > 0 ? distances.reduce((sum, d) => sum + d, 0) : 0
  const totalTravelTime = travelTimes.length > 0 ? travelTimes.reduce((sum, t) => sum + t, 0) : 0

  console.log(`Distance: ${totalDistance.toFixed(2)} mi`)
  console.log(`Travel time: ${totalTravelTime} min\n`)
}

export function logTechServices(techServices) {
  const firstService = techServices[0]
  const lastService = techServices[techServices.length - 1]

  // Format times
  const startTime = dayjs(firstService.start).format('h:mm A')
  const endTime = dayjs(lastService.end).format('h:mm A')

  // Calculate total distance and travel time
  const totalDistance = techServices.reduce(
    (sum, service) => sum + (service.distanceFromPrevious || 0),
    0,
  )
  const totalTravelTime = techServices.reduce(
    (sum, service) => sum + (service.travelTimeFromPrevious || 0),
    0,
  )

  // Log tech header
  console.log(`${firstService.techId} (${startTime} - ${endTime}):`)

  // Log tech services
  for (const [i, service] of techServices.entries()) {
    const time = dayjs(service.start).format('h:mm A')
    const duration = service.time.duration
    const distance = service.distanceFromPrevious?.toFixed(1) || 0
    const travelTime = service.travelTimeFromPrevious || 0
    console.log(
      `  ${i + 1}. ${time} (${duration}m) - ${service.company} (${distance}mi, ${travelTime}m travel)`,
    )
  }

  // Print tech stats
  const distances = techServices
    .map(s => s.distanceFromPrevious || 0)
    .filter(d => d > 0)
  const avgDistance =
    distances.length > 0
      ? distances.reduce((sum, d) => sum + d, 0) / distances.length
      : 0

  const travelTimes = techServices
    .map(s => s.travelTimeFromPrevious || 0)
    .filter(t => t > 0)
  const avgTravelTime =
    travelTimes.length > 0
      ? travelTimes.reduce((sum, t) => sum + t, 0) / travelTimes.length
      : 0

  console.log('')
}

export function logScheduleActivity({ services, clusteringInfo }) {
  if (!services?.length) {
    console.log('No services to log')
    return
  }

  console.log('Clustering info:', clusteringInfo)

  // Log clustering performance metrics
  console.log('\nScheduling Performance:')
  console.log(`Runtime: ${clusteringInfo.performanceDuration}ms`)
  console.log(`Total techs: ${Object.keys(clusteringInfo.techAssignments || {}).length}`)
  console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)

  // Log tech statistics
  const techs = new Set(services.map(s => s.techId).filter(Boolean))
  console.log('\nTech Statistics:')
  console.log(`Number of techs: ${techs.size}`)

  // Calculate average services per tech
  const servicesWithTechs = services.filter(s => s.techId).length
  const avgServicesPerTech = servicesWithTechs / techs.size
  console.log(`Average services per tech: ${avgServicesPerTech.toFixed(2)}`)

  // Group services by tech
  const servicesByTech = new Map()
  const servicesByCompany = new Map()

  for (const service of services) {
    // Group by tech
    if (service.techId) {
      if (!servicesByTech.has(service.techId)) {
        servicesByTech.set(service.techId, [])
      }
      servicesByTech.get(service.techId).push(service)
    }

    // Group by company
    const company = service.company
    if (!servicesByCompany.has(company)) {
      servicesByCompany.set(company, [])
    }
    servicesByCompany.get(company).push(service)
  }

  // Log tech details
  console.log('\nTech Details:')
  
  // Sort tech IDs numerically by the number portion
  const sortedTechIds = [...servicesByTech.keys()].sort((a, b) => {
    const numA = parseInt(a.replace('Tech ', ''))
    const numB = parseInt(b.replace('Tech ', ''))
    return numA - numB
  })

  for (const techId of sortedTechIds) {
    const services = servicesByTech.get(techId)
    const sortedServices = [...services].sort((a, b) => {
      if (a.sequenceNumber !== undefined && b.sequenceNumber !== undefined) {
        return a.sequenceNumber - b.sequenceNumber
      }
      return new Date(a.start) - new Date(b.start)
    })
    logTechServices(sortedServices)
  }
}
