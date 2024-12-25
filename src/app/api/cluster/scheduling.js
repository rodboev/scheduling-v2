import axios from 'axios'
import { chunk } from '../../map/utils/array.js'
import { calculateTravelTime } from '../../map/utils/distance.js'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''
const MAX_CLUSTER_DURATION = 8 * 60 // 8 hours in minutes
const MAX_TIME_SEARCH = 2 * 60 // 2 hours in minutes
const TIME_INCREMENT = 15 // 15 minute increments

function sortServicesByDistance(services) {
  return services.sort((a, b) => (a.distanceFromPrevious || 0) - (b.distanceFromPrevious || 0))
}

function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  // Allow exact minute matches
  if (newStart.getTime() === existingEnd.getTime()) return false
  if (existingStart.getTime() === newEnd.getTime()) return false

  return (
    (newStart >= existingStart && newStart < existingEnd) ||
    (newEnd > existingStart && newEnd <= existingEnd) ||
    (newStart <= existingStart && newEnd >= existingEnd)
  )
}

function calculateTotalDuration(scheduledTimes) {
  if (!scheduledTimes.length) return 0

  // Sort times by start time
  const sortedTimes = scheduledTimes.sort((a, b) => a.start - b.start)

  // Calculate total duration including break times
  const firstStart = sortedTimes[0].start
  const lastEnd = sortedTimes[sortedTimes.length - 1].end
  return (lastEnd - firstStart) / (1000 * 60) // Convert to minutes
}

function findValidTimeSlot(proposedStart, duration, scheduledTimes) {
  const baseTime = new Date(proposedStart)

  // Try current time first
  const currentEnd = new Date(baseTime.getTime() + duration * 60000)
  if (!hasOverlap(baseTime, currentEnd, scheduledTimes)) {
    return baseTime
  }

  // Only try later times in 15-minute increments
  for (let offset = TIME_INCREMENT; offset <= MAX_TIME_SEARCH; offset += TIME_INCREMENT) {
    const laterStart = new Date(baseTime.getTime() + offset * 60000)
    const laterEnd = new Date(laterStart.getTime() + duration * 60000)
    if (!hasOverlap(laterStart, laterEnd, scheduledTimes)) {
      return laterStart
    }
  }

  return null // No valid slot found within 2 hours forward
}

function hasOverlap(start, end, scheduledTimes) {
  return scheduledTimes.some(time => checkTimeOverlap(time.start, time.end, start, end))
}

function sortServicesByEarliestTime(services) {
  return [...services].sort((a, b) => {
    const aStart = new Date(a.time.range[0])
    const bStart = new Date(b.time.range[0])

    // If start times are equal, sort by duration (shorter first)
    if (aStart.getTime() === bStart.getTime()) {
      return a.time.duration - b.time.duration
    }

    return aStart.getTime() - bStart.getTime()
  })
}

function formatDateTime(date) {
  return date.toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function logClusterSchedule(clusterId, services) {
  console.log(`\nCluster ${clusterId} Schedule:`)
  console.log('----------------------------------------')

  // Sort by full date-time, not just time
  const sortedServices = [...services].sort((a, b) => {
    const dateA = new Date(a.start)
    const dateB = new Date(b.start)
    return dateA.getTime() - dateB.getTime()
  })

  let previousService = null
  sortedServices.forEach(service => {
    const start = formatDateTime(new Date(service.start))
    const end = formatDateTime(new Date(service.end))

    let distanceInfo = '(first stop)'
    if (previousService) {
      const distance = service.distanceFromPrevious
        ? `${service.distanceFromPrevious.toFixed(2)} mi from ${previousService.company}`
        : 'distance unknown'
      distanceInfo = `(${distance})`
    }

    console.log(`[${service.sequenceNumber}] ${start} - ${end} ${service.company} ${distanceInfo}`)

    previousService = service
  })

  // Calculate and log total duration
  if (sortedServices.length > 0) {
    const firstStart = new Date(sortedServices[0].start)
    const lastEnd = new Date(sortedServices[sortedServices.length - 1].end)
    const totalMinutes = (lastEnd - firstStart) / (1000 * 60)
    console.log(`Total duration: ${(totalMinutes / 60).toFixed(2)} hours\n`)
  }
}

export async function scheduleServices(services, distanceMatrix = null) {
  let clusters = services.reduce((acc, service) => {
    if (service.cluster >= 0) {
      if (!acc[service.cluster]) acc[service.cluster] = []
      acc[service.cluster].push(service)
    }
    return acc
  }, {})

  let nextClusterId = Math.max(...Object.keys(clusters).map(Number)) + 1
  let unscheduledServices = []

  // Schedule each cluster independently
  for (const [clusterId, clusterServices] of Object.entries(clusters)) {
    let sortedServices = sortServicesByEarliestTime(clusterServices)
    let scheduledTimes = []

    // Schedule first service at its earliest possible time
    let currentService = sortedServices[0]
    const earliestPossibleStart = new Date(currentService.time.range[0])

    currentService.start = earliestPossibleStart.toISOString()
    currentService.end = new Date(
      earliestPossibleStart.getTime() + currentService.time.duration * 60000,
    ).toISOString()
    scheduledTimes.push({
      start: earliestPossibleStart,
      end: new Date(currentService.end),
    })

    // Schedule remaining services with enforced 15-minute gaps
    for (let i = 1; i < sortedServices.length; i++) {
      currentService = sortedServices[i]
      const prevService = sortedServices[i - 1]

      // Always enforce 15-minute gap
      let proposedStart = new Date(new Date(prevService.end).getTime() + 15 * 60000)

      // Ensure we don't schedule before the service's earliest possible time
      const serviceEarliestTime = new Date(currentService.time.range[0])
      if (proposedStart < serviceEarliestTime) {
        proposedStart = serviceEarliestTime
      }

      const validEnd = new Date(proposedStart.getTime() + currentService.time.duration * 60000)

      // Ensure we don't schedule beyond the service's latest possible time
      const serviceLatestEnd = new Date(currentService.time.range[1])
      if (validEnd > serviceLatestEnd) {
        unscheduledServices.push(currentService)
        continue
      }

      // Check if adding this service would exceed 8 hour cluster duration
      const tempTimes = [...scheduledTimes, { start: proposedStart, end: validEnd }]
      const totalDuration = calculateTotalDuration(tempTimes)

      if (totalDuration <= MAX_CLUSTER_DURATION) {
        currentService.start = proposedStart.toISOString()
        currentService.end = validEnd.toISOString()
        scheduledTimes.push({ start: proposedStart, end: validEnd })
        currentService.previousCompany = prevService.company
      } else {
        unscheduledServices.push(currentService)
      }
    }

    // Log schedule for first 10 clusters
    if (parseInt(clusterId) < 10) {
      logClusterSchedule(
        clusterId,
        clusterServices.filter(service => !unscheduledServices.includes(service)),
      )
    }
  }

  // Try to schedule unscheduled services in new clusters
  while (unscheduledServices.length > 0) {
    const newCluster = []
    let scheduledTimes = []

    for (const service of [...unscheduledServices]) {
      if (newCluster.length === 0) {
        // First service handling remains the same
        const earliestStart = new Date(service.time.range[0])
        service.cluster = nextClusterId
        service.start = earliestStart.toISOString()
        service.end = new Date(
          earliestStart.getTime() + service.time.duration * 60000,
        ).toISOString()
        newCluster.push(service)
        scheduledTimes.push({
          start: earliestStart,
          end: new Date(service.end),
        })
        unscheduledServices = unscheduledServices.filter(s => s !== service)
      } else {
        const lastService = newCluster[newCluster.length - 1]

        // Always enforce 15-minute gap
        let proposedStart = new Date(new Date(lastService.end).getTime() + 15 * 60000)

        if (proposedStart <= new Date(service.time.range[1])) {
          const validEnd = new Date(proposedStart.getTime() + service.time.duration * 60000)

          const tempTimes = [...scheduledTimes, { start: proposedStart, end: validEnd }]
          const totalDuration = calculateTotalDuration(tempTimes)

          if (totalDuration <= MAX_CLUSTER_DURATION) {
            service.cluster = nextClusterId
            service.start = proposedStart.toISOString()
            service.end = validEnd.toISOString()
            newCluster.push(service)
            scheduledTimes.push({ start: proposedStart, end: validEnd })
            service.previousCompany = lastService.company
            unscheduledServices = unscheduledServices.filter(s => s !== service)
          }
        }
      }
    }

    if (newCluster.length > 0) {
      clusters[nextClusterId] = newCluster
      // Log new cluster if it's one of first 10
      if (nextClusterId < 10) {
        logClusterSchedule(nextClusterId, newCluster)
      }
      nextClusterId++
    }
  }

  // After ALL services are scheduled, sort ALL services chronologically
  const allScheduledServices = services.filter(service => service.cluster >= 0 && service.start)

  // Sort by actual scheduled start time (not range)
  const sortedByStartTime = [...allScheduledServices].sort((a, b) => {
    const dateA = new Date(a.start).getTime()
    const dateB = new Date(b.start).getTime()
    return dateA - dateB
  })

  // Clear all existing sequence numbers first
  for (let i = 0; i < services.length; i++) {
    services[i].sequenceNumber = null
  }

  // Assign new sequence numbers based on chronological order
  for (let i = 0; i < sortedByStartTime.length; i++) {
    const service = sortedByStartTime[i]
    const sequenceNumber = i + 1

    // Find the index in the original services array and update directly
    const index = services.findIndex(s => s.id === service.id)
    if (index !== -1) {
      services[index].sequenceNumber = sequenceNumber
    }
  }

  // Log the final sequence order for verification
  console.log('\nFinal Sequence Order (After Assignment):')
  console.log('----------------------------------------')
  const verificationSort = [...services]
    .filter(s => s.cluster >= 0 && s.start)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  verificationSort.forEach(service => {
    console.log(
      `[${service.sequenceNumber}] ${new Date(service.start).toLocaleString()} - ${service.company} (cluster ${service.cluster})`,
    )
  })

  return services
}
