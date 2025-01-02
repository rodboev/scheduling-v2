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

export function logScheduleActivity({ services, clusteringInfo }) {
  try {
    console.log('\n=== Schedule Statistics ===')
    console.log('Services:', services.length)
    console.log('Clustering info:', clusteringInfo)

    // Log clustering performance metrics
    console.log('\nClustering Performance:')
    console.log(`Runtime: ${clusteringInfo.performanceDuration}ms`)
    console.log(`Total clusters: ${clusteringInfo.totalClusters}`)
    console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)

    // Log cluster statistics
    const clusters = new Set(services.map(s => s.cluster).filter(c => c >= 0))
    console.log('\nCluster Statistics:')
    console.log(`Number of clusters: ${clusters.size}`)

    // Calculate average services per cluster
    const servicesInClusters = services.filter(s => s.cluster >= 0).length
    const avgServicesPerCluster = servicesInClusters / clusters.size
    console.log(`Average services per cluster: ${avgServicesPerCluster.toFixed(2)}`)

    // Group services by cluster and tech
    const servicesByCluster = new Map()
    const servicesByTech = new Map()

    for (const service of services) {
      // Group by cluster
      if (service.cluster >= 0) {
        if (!servicesByCluster.has(service.cluster)) {
          servicesByCluster.set(service.cluster, [])
        }
        servicesByCluster.get(service.cluster).push(service)
      }

      // Group by tech
      if (service.techId) {
        if (!servicesByTech.has(service.techId)) {
          servicesByTech.set(service.techId, [])
        }
        servicesByTech.get(service.techId).push(service)
      }
    }

    // Log cluster details
    console.log('\nCluster Details:')
    for (const [cluster, clusterServices] of servicesByCluster) {
      const sortedServices = clusterServices.sort((a, b) => new Date(a.start) - new Date(b.start))
      logClusterServices(sortedServices)
    }

    // Log tech assignments
    console.log('\nTech Assignments:')
    for (const [techId, techServices] of servicesByTech) {
      const servicesByDate = new Map()
      for (const service of techServices) {
        const date = dayjs(service.start).format('YYYY-MM-DD')
        if (!servicesByDate.has(date)) {
          servicesByDate.set(date, [])
        }
        servicesByDate.get(date).push(service)
      }

      console.log(`\n${techId}:`)
      for (const [date, dateServices] of servicesByDate) {
        const sortedServices = dateServices.sort((a, b) => new Date(a.start) - new Date(b.start))
        logClusterServices(sortedServices)
      }
    }
  } catch (error) {
    console.error('Error logging schedule activity:', error)
  }
}
