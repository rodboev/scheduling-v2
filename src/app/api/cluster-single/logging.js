import { formatDate, formatTime, calculateDuration } from '../../utils/dateHelpers.js'
import { calculateHaversineDistance } from '../../map/utils/distance.js'

export function logMapActivity({ services, clusteringInfo, algorithm }) {
  console.log('\nMap Activity Log:\n')

  // Log basic request info
  console.log('Request Summary:')
  console.log(`Algorithm: ${algorithm}`)
  console.log(`Total Services: ${services.length}`)

  if (clusteringInfo) {
    console.log('\nClustering Results:')
    console.log(`- Processing Time: ${clusteringInfo.performanceDuration}ms`)
    console.log(`- Connected Points: ${clusteringInfo.connectedPointsCount}`)
    console.log(`- Total Clusters: ${clusteringInfo.totalClusters}`)
    console.log(`- Outliers: ${clusteringInfo.outlierCount}`)
  }

  // Group services by cluster
  const clusters = services.reduce((acc, service) => {
    const clusterKey = service.cluster >= 0 ? service.cluster : 'unclustered'
    if (!acc[clusterKey]) acc[clusterKey] = []
    acc[clusterKey].push(service)
    return acc
  }, {})

  console.log('\nCluster Details:')
  Object.entries(clusters).forEach(([clusterId, clusterServices]) => {
    console.log(`\nCluster ${clusterId}:`)
    console.log(`Services in cluster: ${clusterServices.length}`)

    // Sort services by time
    const sortedServices = [...clusterServices].sort(
      (a, b) => new Date(a.time.range[0]) - new Date(b.time.range[0]),
    )

    // Get cluster time range
    if (sortedServices.length > 0) {
      const firstService = sortedServices[0]
      const lastService = sortedServices[sortedServices.length - 1]
      const clusterStart = new Date(firstService.time.range[0])
      const clusterEnd = new Date(lastService.time.range[1])
      console.log(
        `Time Range: ${formatDate(clusterStart)} ${formatTime(clusterStart)} - ${formatTime(clusterEnd)}`,
      )
    }

    // Calculate distances between sequential services
    const servicesWithDistance = sortedServices.map((service, index) => {
      if (index === 0) return { ...service, distanceFromPrevious: 0, previousCompany: null }

      const previousService = sortedServices[index - 1]
      const distance = calculateHaversineDistance(
        previousService.location.latitude,
        previousService.location.longitude,
        service.location.latitude,
        service.location.longitude,
      )

      return {
        ...service,
        distanceFromPrevious: distance,
        previousCompany: previousService.company,
      }
    })

    servicesWithDistance.forEach((service, index) => {
      const scheduledStart = new Date(service.start)
      const scheduledEnd = new Date(service.end)
      const rangeStart = new Date(service.time.range[0])
      const rangeEnd = new Date(service.time.range[1])

      const scheduledTime = `${formatTime(scheduledStart)}-${formatTime(scheduledEnd)}`
      const timeRange = `${formatTime(rangeStart)}-${formatTime(rangeEnd)}`

      const distance =
        index === 0
          ? '(first location)'
          : `(${service.distanceFromPrevious.toFixed(2)} mi from ${service.previousCompany})`

      console.log(
        `- ${index + 1}: ${formatDate(scheduledStart)}, ${scheduledTime}, ` +
          `${service.company} (${service.location.latitude}, ${service.location.longitude}) ` +
          `(range: ${timeRange}) ${distance}`,
      )
    })

    // Calculate and log cluster metrics
    if (servicesWithDistance.length > 0) {
      const firstService = servicesWithDistance[0]
      const lastService = servicesWithDistance[servicesWithDistance.length - 1]
      const clusterDuration = calculateDuration(
        new Date(firstService.time.range[0]),
        new Date(lastService.time.range[1]),
      )
      console.log(`\nCluster duration: ${clusterDuration.toFixed(2)} hours`)

      // Calculate total distance
      const totalDistance = servicesWithDistance.reduce((acc, service) => {
        return acc + (service.distanceFromPrevious || 0)
      }, 0)
      console.log(`Total cluster distance: ${totalDistance.toFixed(2)} miles`)
    }
  })

  console.log('\n-------------------\n')
}

// Add borough-specific logging
export function logBoroughStats(services) {
  const boroughCounts = services.reduce((acc, service) => {
    const borough = service.borough || 'unknown'
    acc[borough] = (acc[borough] || 0) + 1
    return acc
  }, {})

  console.log('\nBorough distribution:', boroughCounts)

  // Log services with unknown boroughs
  const unknownServices = services.filter((s) => !s.borough)
  if (unknownServices.length > 0) {
    console.log(
      '\nServices with unknown boroughs:',
      unknownServices.map((s) => ({
        company: s.company,
        address: s.location.address,
        coordinates: [s.location.latitude, s.location.longitude],
      })),
    )
  }
}
