import dayjs from 'dayjs'
import { calculateHaversineDistance, calculateTravelTime } from './distance'

function formatTimeRange(start, end) {
  return `${dayjs(start).format('M/D, h:mm a')}-${dayjs(end).format('h:mm a')}`
}

function findGaps(services) {
  const gaps = []
  const sortedServices = [...services].sort(
    (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
  )

  for (let i = 0; i < sortedServices.length - 1; i++) {
    const currentEnd =
      new Date(sortedServices[i].time.visited).getTime() +
      sortedServices[i].time.duration * 60000
    const nextStart = new Date(sortedServices[i + 1].time.visited).getTime()

    const gapDuration = (nextStart - currentEnd) / (60 * 60 * 1000) // hours
    if (gapDuration > 0.25) {
      // Only log gaps longer than 15 minutes
      gaps.push({
        start: new Date(currentEnd),
        end: new Date(nextStart),
        duration: gapDuration,
      })
    }
  }
  return gaps
}

function calculateDistance(from, to) {
  return calculateHaversineDistance(
    from.location.latitude,
    from.location.longitude,
    to.location.latitude,
    to.location.longitude,
  )
}

function calculateClusterStats(services) {
  let totalDistance = 0
  let totalTravelTime = 0
  let totalTimeGap = 0
  let gapCount = 0

  for (let i = 1; i < services.length; i++) {
    const current = services[i]
    const prev = services[i - 1]

    const distance = calculateDistance(current, prev)
    totalDistance += distance
    totalTravelTime += calculateTravelTime(distance)

    const timeGap =
      (new Date(current.time.visited).getTime() -
        (new Date(prev.time.visited).getTime() + prev.time.duration * 60000)) /
      (60 * 1000)

    if (timeGap > 0) {
      totalTimeGap += timeGap
      gapCount++
    }
  }

  const first = services[0]
  const last = services[services.length - 1]
  const duration =
    (new Date(last.time.visited).getTime() +
      last.time.duration * 60000 -
      new Date(first.time.visited).getTime()) /
    (60 * 60 * 1000) // hours

  return {
    avgDistance:
      services.length > 1 ? totalDistance / (services.length - 1) : 0,
    totalTravelTime,
    avgTimeGap: gapCount > 0 ? totalTimeGap / gapCount : 0,
    duration,
  }
}

export function logSchedule(services) {
  if (!services || !Array.isArray(services)) {
    console.warn('Invalid services array provided to logSchedule')
    return ''
  }

  // First group by original cluster number
  const originalClusters = services.reduce((acc, service) => {
    if (service.cluster >= 0) {
      if (!acc[service.cluster]) acc[service.cluster] = []
      acc[service.cluster].push(service)
    } else {
      // Group unscheduled services by their cluster type
      switch (service.cluster) {
        case -1:
          if (!acc.noise) acc.noise = []
          acc.noise.push(service)
          break
        case -2:
          if (!acc.outliers) acc.outliers = []
          acc.outliers.push(service)
          break
        case -3:
          if (!acc.overlap) acc.overlap = []
          acc.overlap.push(service)
          break
        case -4:
          if (!acc.outOfRange) acc.outOfRange = []
          acc.outOfRange.push(service)
          break
        default:
          if (!acc.other) acc.other = []
          acc.other.push(service)
      }
    }
    return acc
  }, {})

  let log = ''

  // Add scheduling priority info
  const hasDifferentReasons = services.some(s => s.schedulingReason)
  if (hasDifferentReasons) {
    log += '\nScheduling Decisions:\n'
    for (const service of services.filter(s => s.schedulingReason)) {
      log += `- ${service.company}: ${service.schedulingReason}\n`
    }
    log += '\n'
  }

  // Process each original cluster
  for (const [clusterNum, clusterServices] of Object.entries(
    originalClusters,
  )) {
    if (
      clusterNum === 'noise' ||
      clusterNum === 'outliers' ||
      clusterNum === 'overlap' ||
      clusterNum === 'outOfRange' ||
      clusterNum === 'other'
    )
      continue

    // Sort services by visited time
    const sortedServices = [...clusterServices].sort(
      (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
    )

    // Split into sub-clusters based on 8-hour windows
    const subClusters = []
    let currentCluster = []
    let clusterStartTime = null

    for (const service of sortedServices) {
      const serviceStart = new Date(service.time.visited)
      const serviceEnd = new Date(
        serviceStart.getTime() + service.time.duration * 60000,
      )

      if (!clusterStartTime) {
        clusterStartTime = serviceStart
        currentCluster.push(service)
        continue
      }

      // Check if this service would exceed 8 hours from cluster start
      const eightHours = 8 * 60 * 60 * 1000
      if (serviceEnd.getTime() - clusterStartTime.getTime() > eightHours) {
        // Start a new cluster
        subClusters.push(currentCluster)
        currentCluster = [service]
        clusterStartTime = serviceStart
      } else {
        currentCluster.push(service)
      }
    }

    if (currentCluster.length > 0) {
      subClusters.push(currentCluster)
    }

    // Log each sub-cluster
    subClusters.forEach((subCluster, subIndex) => {
      const firstService = subCluster[0]
      const lastService = subCluster[subCluster.length - 1]
      const clusterStart = new Date(firstService.time.visited)
      const clusterEnd =
        new Date(lastService.time.visited).getTime() +
        lastService.time.duration * 60000

      log += `\nCluster ${clusterNum}${subClusters.length > 1 ? `-${subIndex + 1}` : ''} `
      log += `(${dayjs(clusterStart).format('h:mm a')} - ${dayjs(clusterEnd).format('h:mm a')}):\n`

      // For each service in cluster, show both time and distance metrics
      for (let i = 0; i < subCluster.length; i++) {
        const service = subCluster[i]
        const visitStart = new Date(service.time.visited)
        const visitEnd = new Date(
          visitStart.getTime() + service.time.duration * 60000,
        )
        const timeRange = service.time.range.map(t => new Date(t))

        let metrics = ''
        if (i > 0) {
          const prevService = subCluster[i - 1]
          const distance = calculateDistance(service, prevService)
          const travelTime = calculateTravelTime(distance)
          const timeGap =
            (new Date(service.time.visited).getTime() -
              (new Date(prevService.time.visited).getTime() +
                prevService.time.duration * 60000)) /
            (60 * 1000)

          metrics = ` (${distance.toFixed(2)} mi / ${travelTime.toFixed(0)} min from ${prevService.company}, gap: ${timeGap.toFixed(0)} min)`
        }

        log += `- ${formatTimeRange(visitStart, visitEnd)}, ${service.company} `
        log += `(${service.location.latitude}, ${service.location.longitude}) `
        log += `(range: ${dayjs(timeRange[0]).format('h:mm a')} - ${dayjs(timeRange[1]).format('h:mm a')})${metrics}\n`
      }

      // Add cluster statistics
      const clusterStats = calculateClusterStats(subCluster)
      log += 'Cluster Statistics:\n'
      log += `  Average Distance: ${clusterStats.avgDistance.toFixed(2)} mi\n`
      log += `  Total Travel Time: ${clusterStats.totalTravelTime.toFixed(0)} min\n`
      log += `  Average Time Gap: ${clusterStats.avgTimeGap.toFixed(0)} min\n`
      log += `Cluster duration: ${clusterStats.duration.toFixed(2)} hours\n`

      const gaps = findGaps(subCluster)
      if (gaps.length > 0) {
        log += 'Gaps in this cluster:\n'
        for (const [index, gap] of gaps.entries()) {
          log += `  Gap ${index + 1}: ${dayjs(gap.start).format('M/D h:mm a')} - `
          log += `${dayjs(gap.end).format('h:mm a')} (${gap.duration.toFixed(2)} hours)\n`
        }
      }
    })
  }

  // Log unscheduled services
  const unscheduledGroups = {
    noise: {
      label: 'Noise Points (cluster -1)',
      services: originalClusters.noise,
    },
    outliers: {
      label: 'Outliers (cluster -2)',
      services: originalClusters.outliers,
    },
    overlap: {
      label: 'Would Overlap (cluster -3)',
      services: originalClusters.overlap,
    },
    outOfRange: {
      label: 'Out of Range (cluster -4)',
      services: originalClusters.outOfRange,
    },
    other: { label: 'Other Unscheduled', services: originalClusters.other },
  }

  let hasUnscheduled = false
  for (const [key, group] of Object.entries(unscheduledGroups)) {
    if (group.services?.length > 0) {
      if (!hasUnscheduled) {
        log += '\nUnscheduled Services:\n'
        hasUnscheduled = true
      }

      log += `\n${group.label}:\n`
      for (const service of group.services) {
        const timeRange = service.time.range.map(t => new Date(t))
        log += `- ${service.company} `
        log += `(${service.location.latitude}, ${service.location.longitude}) `
        log += `(range: ${dayjs(timeRange[0]).format('M/D h:mm a')} - `
        log += `${dayjs(timeRange[1]).format('h:mm a')}) `
        log += `[${service.time.duration} min]\n`
      }
    }
  }

  console.log(log)
  return log
}
