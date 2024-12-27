import { findGaps } from '@/app/utils/gaps'
import dayjs from 'dayjs'
import { getDistance, calculateTravelTime } from './distance'

function formatTimeRange(start, end) {
  return `${dayjs(start).format('M/D, h:mm a')}-${dayjs(end).format('h:mm a')}`
}

async function calculateClusterStats(services) {
  let totalDistance = 0
  let totalTravelTime = 0
  let totalTimeGap = 0
  let gapCount = 0

  for (let i = 1; i < services.length; i++) {
    const current = services[i]
    const prev = services[i - 1]

    const distance = await getDistance(prev, current)
    if (distance) {
      totalDistance += distance
      const travelTime = calculateTravelTime(distance)
      if (travelTime) totalTravelTime += travelTime
    }

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
    avgDistance: services.length > 1 ? totalDistance / (services.length - 1) : 0,
    totalTravelTime,
    avgTimeGap: gapCount > 0 ? totalTimeGap / gapCount : 0,
    duration,
  }
}

export async function logSchedule(services) {
  if (!services || !Array.isArray(services)) {
    console.warn('Invalid services array provided to logSchedule')
    return ''
  }

  const output = []
  output.push('Schedule Summary:')

  // Sort services by time
  const sortedServices = [...services].sort(
    (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
  )

  // Group services by cluster
  const clusters = sortedServices.reduce((acc, service) => {
    const clusterKey = service.cluster >= 0 ? service.cluster : 'unclustered'
    if (!acc[clusterKey]) acc[clusterKey] = []
    acc[clusterKey].push(service)
    return acc
  }, {})

  // Process each cluster
  for (const [clusterId, clusterServices] of Object.entries(clusters)) {
    output.push(`\nCluster ${clusterId}:`)
    output.push(`Services in cluster: ${clusterServices.length}`)

    // Sort services by time within cluster
    const sortedClusterServices = [...clusterServices].sort(
      (a, b) => new Date(a.time.visited) - new Date(b.time.visited),
    )

    // Calculate and log distances between sequential services
    for (let i = 0; i < sortedClusterServices.length; i++) {
      const service = sortedClusterServices[i]
      const scheduledStart = new Date(service.start)
      const scheduledEnd = new Date(service.end)
      const rangeStart = new Date(service.time.range[0])
      const rangeEnd = new Date(service.time.range[1])

      const scheduledTime = `${formatTime(scheduledStart)}-${formatTime(scheduledEnd)}`
      const timeRange = `${formatTime(rangeStart)}-${formatTime(rangeEnd)}`

      let distanceInfo = '(first location)'
      if (i > 0) {
        const previousService = sortedClusterServices[i - 1]
        const distance = await getDistance(previousService, service)
        distanceInfo = distance
          ? `(${distance.toFixed(2)} mi from ${previousService.company})`
          : `(distance unknown from ${previousService.company})`
      }

      output.push(
        `- ${i + 1}: ${formatDate(scheduledStart)}, ${scheduledTime}, ` +
          `${service.company} (${service.location.latitude}, ${service.location.longitude}) ` +
          `(range: ${timeRange}) ${distanceInfo}`,
      )
    }

    // Calculate and log cluster metrics
    if (sortedClusterServices.length > 0) {
      const stats = await calculateClusterStats(sortedClusterServices)
      output.push(`\nCluster duration: ${stats.duration.toFixed(2)} hours`)
      output.push(`Total cluster distance: ${stats.avgDistance.toFixed(2)} miles`)
      output.push(`Average time gap: ${stats.avgTimeGap.toFixed(2)} minutes`)
      output.push(`Total travel time: ${stats.totalTravelTime} minutes`)
    }
  }

  // Find gaps between clusters
  const gaps = findGaps(sortedServices)
  if (gaps.length > 0) {
    output.push('\nGaps between clusters:')
    for (const gap of gaps) {
      output.push(`- ${formatTimeRange(gap.start, gap.end)} (${gap.duration.toFixed(2)} minutes)`)
    }
  }

  return output.join('\n')
}

function logScheduleGaps(shift, shiftStart, shiftEnd) {
  const gaps = findGaps({
    shift,
    from: shiftStart,
    to: shiftEnd,
    minimumGap: 15, // 15 minutes minimum gap
  })

  if (gaps.length > 0) {
    console.log('Gaps in this shift:')
    for (const [index, gap] of gaps.entries()) {
      console.log(
        `  Gap ${index + 1}: ${formatTimeRange(gap.start, gap.end)} (${gap.duration.toFixed(2)} hours)`,
      )
    }
  } else {
    console.log('No gaps found in this shift.')
  }
}
