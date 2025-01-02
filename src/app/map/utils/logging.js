import { formatTime } from '@/app/utils/dateHelpers'

export async function logMapActivity({ services, clusteringInfo }) {
  try {
    console.log('Logging map activity...')
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

    // Log distance and time statistics by cluster
    for (const cluster of clusters) {
      const clusterServices = services
        .filter(s => s.cluster === cluster)
        .sort((a, b) => new Date(a.start) - new Date(b.start))

      if (clusterServices.length === 0) continue

      logClusterServices(clusterServices)
    }
  } catch (error) {
    console.error('Error logging map activity:', error)
  }
}

function logClusterServices(clusterServices) {
  console.log(
    `Cluster ${clusterServices[0].cluster} (${formatTime(clusterServices[0].start)} - ${formatTime(clusterServices[clusterServices.length - 1].end)}):`,
  )

  // Log cluster services
  for (const [i, service] of clusterServices.entries()) {
    const start = new Date(service.start)
    const distance = service.distanceFromPrevious || 0
    const travelTime = service.travelTimeFromPrevious || 0

    let line = `- ${formatServiceTime(service)}`
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

  console.log('\nCluster Stats:')
  console.log(`  Total Distance: ${totalDistance.toFixed(2)} mi`)
  console.log(`  Total Travel Time: ${totalTravelTime} min`)
}

// Format service time for logging
const formatServiceTime = service => {
  const start = new Date(service.start)
  const end = new Date(service.end)
  const date = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  const startTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const endTime = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const rangeStart = new Date(service.time.range[0])
  const rangeEnd = new Date(service.time.range[1])
  const rangeStartTime = rangeStart.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  const rangeEndTime = rangeEnd.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })
  return `${date} ${startTime}-${endTime}, ${service.company} (${service.location.latitude}, ${service.location.longitude}) (range: ${rangeStartTime}-${rangeEndTime})`
}
