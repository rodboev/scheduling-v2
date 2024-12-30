import { logSchedule } from './scheduleLogger'
import { formatTime } from '@/app/utils/dateHelpers'

export async function logMapActivity({ services, clusteringInfo }) {
  try {
    console.log('Logging map activity...')
    console.log('Services:', services.length)
    console.log('Clustering info:', clusteringInfo)

    // Log the schedule details
    const scheduleLog = logSchedule(services)
    console.log(scheduleLog)

    // Log clustering performance metrics
    console.log('\nClustering Performance:')
    console.log(`Runtime: ${clusteringInfo.performanceDuration}ms`)
    console.log(`Total clusters: ${clusteringInfo.totalClusters}`)
    console.log(`Connected points: ${clusteringInfo.connectedPointsCount}`)
    console.log(`Outliers: ${clusteringInfo.outlierCount}`)

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

      const firstService = clusterServices[0]
      const lastService = clusterServices[clusterServices.length - 1]
      const clusterStart = new Date(firstService.start)
      const clusterEnd = new Date(lastService.end)

      console.log(`\nCluster ${cluster} (${formatTime(clusterStart)} - ${formatTime(clusterEnd)}):`)

      for (let i = 0; i < clusterServices.length; i++) {
        const service = clusterServices[i]
        const start = new Date(service.start)
        const end = new Date(service.end)
        const rangeStart = new Date(service.time.range[0])
        const rangeEnd = new Date(service.time.range[1])

        let line = `- ${formatTime(start)}-${formatTime(end)}, ${service.company} `
        line += `(${service.location.latitude}, ${service.location.longitude}) `
        line += `(range: ${formatTime(rangeStart)}-${formatTime(rangeEnd)})`

        if (i > 0) {
          const distance = service.distanceFromPrevious?.toFixed(2) || 'unknown'
          const travelTime = service.travelTimeFromPrevious || 'unknown'
          const timeGap = (start - new Date(clusterServices[i - 1].end)) / (60 * 1000)
          line += ` (${distance} mi / ${travelTime} min from ${service.previousCompany}, gap: ${timeGap.toFixed(0)} min)`
        }

        console.log(line)
      }

      // Calculate cluster statistics
      const distances = clusterServices
        .filter(s => s.distanceFromPrevious !== undefined)
        .map(s => s.distanceFromPrevious)

      const travelTimes = clusterServices
        .filter(s => s.travelTimeFromPrevious !== undefined)
        .map(s => s.travelTimeFromPrevious)

      const timeGaps = []
      for (let i = 1; i < clusterServices.length; i++) {
        const prevEnd = new Date(clusterServices[i - 1].end)
        const currentStart = new Date(clusterServices[i].start)
        if (!isNaN(prevEnd) && !isNaN(currentStart)) {
          timeGaps.push((currentStart - prevEnd) / (60 * 1000))
        }
      }

      const avgDistance =
        distances.length > 0 ? distances.reduce((sum, d) => sum + d, 0) / distances.length : 0

      const totalTravelTime =
        travelTimes.length > 0 ? travelTimes.reduce((sum, t) => sum + t, 0) : 0

      const avgTimeGap =
        timeGaps.length > 0 ? timeGaps.reduce((sum, g) => sum + g, 0) / timeGaps.length : 0

      const clusterDuration = (clusterEnd - clusterStart) / (60 * 60 * 1000)

      console.log('Cluster Statistics:')
      console.log(`  Average Distance: ${avgDistance.toFixed(2)} mi`)
      console.log(`  Total Travel Time: ${totalTravelTime} min`)
      console.log(`  Average Time Gap: ${avgTimeGap.toFixed(0)} min`)
      console.log(`Cluster duration: ${clusterDuration.toFixed(2)} hours`)
    }
  } catch (error) {
    console.error('Error logging map activity:', error)
  }
}
