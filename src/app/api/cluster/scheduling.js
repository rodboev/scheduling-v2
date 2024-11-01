import axios from 'axios'
import { calculateTravelTime } from '../../utils/distance.js'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

// Helper function to get distance using API
async function getDistance(fromService, toService) {
  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: {
        fromId: fromService.location.id.toString(),
        toId: toService.location.id.toString(),
      },
    })
    return response.data.distance
  } catch (error) {
    console.error('Failed to get distance from API:', error)
    // Fallback to Haversine
    return calculateTravelTime(
      fromService.location.latitude,
      fromService.location.longitude,
      toService.location.latitude,
      toService.location.longitude,
    )
  }
}

export function isWithinTimeWindow(startTime, serviceTime) {
  const eightHours = 8 * 60 * 60 * 1000
  const serviceStart = new Date(serviceTime)
  return serviceStart.getTime() - startTime.getTime() < eightHours
}

export function canScheduleService(service, scheduledServices, proposedTime) {
  const duration = service.time.duration
  const proposedEnd = new Date(proposedTime.getTime() + duration * 60000)
  const timeRange = service.time.range.map(t => new Date(t))

  if (proposedTime < timeRange[0] || proposedEnd > timeRange[1]) return false

  for (const scheduled of scheduledServices) {
    const scheduledStart = new Date(scheduled.time.visited)
    const scheduledEnd = new Date(
      scheduledStart.getTime() + scheduled.time.duration * 60000,
    )

    if (
      (proposedTime >= scheduledStart && proposedTime < scheduledEnd) ||
      (proposedEnd > scheduledStart && proposedEnd <= scheduledEnd) ||
      (proposedTime <= scheduledStart && proposedEnd >= scheduledEnd)
    ) {
      return false
    }
  }

  return true
}

export function canShiftService(
  service,
  newTime,
  scheduledServices,
  maxShift = 120,
) {
  const timeRange = service.time.range.map(t => new Date(t))
  const shiftAmount =
    Math.abs(newTime - new Date(service.time.visited)) / (60 * 1000)

  if (shiftAmount > maxShift) return false

  const serviceEnd = new Date(newTime.getTime() + service.time.duration * 60000)
  if (newTime < timeRange[0] || serviceEnd > timeRange[1]) return false

  for (const other of scheduledServices) {
    if (other === service) continue
    const otherStart = new Date(other.time.visited)
    const otherEnd = new Date(
      otherStart.getTime() + other.time.duration * 60000,
    )

    if (
      (newTime >= otherStart && newTime < otherEnd) ||
      (serviceEnd > otherStart && serviceEnd <= otherEnd) ||
      (newTime <= otherStart && serviceEnd >= otherEnd)
    ) {
      return false
    }
  }

  return true
}

export async function tryShiftAdjacentServices(
  service,
  scheduledServices,
  firstServiceStart,
  distanceBias,
) {
  const timeRange = service.time.range.map(t => new Date(t))
  const duration = service.time.duration
  let bestSolution = null
  let bestScore = Number.POSITIVE_INFINITY

  const startTime = Date.now()
  const lastScheduled = [...scheduledServices].sort(
    (a, b) => new Date(b.time.visited) - new Date(a.time.visited),
  )[0]

  for (
    let time = timeRange[0];
    time <= timeRange[1];
    time = new Date(time.getTime() + 15 * 60000)
  ) {
    if (Date.now() - startTime > 500) break

    const serviceEnd = new Date(time.getTime() + duration * 60000)
    if (!isWithinTimeWindow(firstServiceStart, serviceEnd)) continue

    const conflicts = scheduledServices.filter(scheduled => {
      const scheduledStart = new Date(scheduled.time.visited)
      const scheduledEnd = new Date(
        scheduledStart.getTime() + scheduled.time.duration * 60000,
      )
      return (
        (time >= scheduledStart && time < scheduledEnd) ||
        (serviceEnd > scheduledStart && serviceEnd <= scheduledEnd) ||
        (time <= scheduledStart && serviceEnd >= scheduledEnd)
      )
    })

    const shifts = new Map()
    let canFit = true

    for (const conflict of conflicts) {
      let shifted = false
      const conflictStart = new Date(conflict.time.visited)

      for (let shift = 15; shift <= 120; shift += 15) {
        const forwardTime = new Date(conflictStart.getTime() + shift * 60000)
        const backwardTime = new Date(conflictStart.getTime() - shift * 60000)

        if (canShiftService(conflict, forwardTime, scheduledServices)) {
          shifts.set(conflict, forwardTime)
          shifted = true
          break
        }

        if (canShiftService(conflict, backwardTime, scheduledServices)) {
          shifts.set(conflict, backwardTime)
          shifted = true
          break
        }
      }

      if (!shifted) {
        canFit = false
        break
      }
    }

    if (canFit) {
      const timeGap =
        Math.abs(
          time.getTime() -
            (new Date(lastScheduled.time.visited).getTime() +
              lastScheduled.time.duration * 60000),
        ) /
        (60 * 1000)

      const distance = calculateTravelTime(
        service.location.latitude,
        service.location.longitude,
        lastScheduled.location.latitude,
        lastScheduled.location.longitude,
      )

      let score
      if (distanceBias === 0) {
        score = timeGap
      } else if (distanceBias === 100) {
        score = distance * 1000 + timeGap / 1000
      } else {
        const distanceWeight = distanceBias / 100
        const timeWeight = 1 - distanceWeight
        score = timeWeight * timeGap + distanceWeight * distance * 60
      }

      if (score < bestScore) {
        bestScore = score
        bestSolution = { shifts, time }
      }
    }
  }

  if (bestSolution) {
    for (const [service, newTime] of bestSolution.shifts) {
      service.time.visited = newTime.toISOString()
    }
    return bestSolution.time
  }

  return null
}

/**
 * Finds the earliest available service from a list of unscheduled services
 * @param {Array} services - Array of unscheduled services to search through
 * @returns {Object} The service with the earliest start time
 */
function findEarliestService(services) {
  return services.reduce((earliest, current) => {
    if (!earliest) return current
    // Use time.range[0] instead of startTime since that's our time window start
    return new Date(current.time.range[0]) < new Date(earliest.time.range[0])
      ? current
      : earliest
  }, null)
}

/**
 * Main scheduling function that assigns services to time slots
 * @param {Array} services - Array of services to schedule
 * @param {boolean} shouldClusterNoise - Whether to include noise points
 * @param {number} distanceBias - Weight for distance vs time (0-100)
 * @param {number} minPoints - Minimum points per cluster
 * @param {number} maxPoints - Maximum points per cluster
 */
export async function scheduleServices(
  services,
  shouldClusterNoise = true,
  distanceBias = 50,
  minPoints = 4,
  maxPoints = 24,
) {
  const startTime = Date.now()
  const TIMEOUT_MS = 1000 // 1 second timeout

  // Check if we're over time limit
  function isTimedOut() {
    return Date.now() - startTime > TIMEOUT_MS
  }

  try {
    const unscheduledServices = []
    const clusters = []
    let currentCluster = []
    const eightHours = 8 * 60 * 60 * 1000

  // Reset cluster assignments - treat all schedulable services as potential candidates
    const schedulableServices = services
      .filter(s => s.cluster >= 0 || (shouldClusterNoise && s.cluster === -1))
      .map(s => ({
        ...s,
        cluster: 0,
      }))

    while (schedulableServices.length > 0) {
      // Check timeout at the start of each major operation
      if (isTimedOut()) {
        console.log('Scheduling timed out - reverting to original services')
        throw new Error('SCHEDULING_TIMEOUT')
      }

      // Start a new cluster
      currentCluster = []

      // Find the earliest unscheduled service to start this cluster
      const firstService = findEarliestService(schedulableServices)
      if (!firstService) break

      const clusterStartTime = new Date(firstService.time.range[0])
      firstService.time.visited = clusterStartTime.toISOString()
      currentCluster.push(firstService)

      schedulableServices.splice(
        schedulableServices.findIndex(s => s.id === firstService.id),
        1,
      )

      // Keep adding services to cluster until we hit constraints
      while (schedulableServices.length > 0) {
        let bestService = null
        let bestTime = null
        let bestScore = Number.POSITIVE_INFINITY

        for (const service of schedulableServices) {
          const lastScheduled = currentCluster[currentCluster.length - 1]

          // Calculate base distance score
          const distance = calculateTravelTime(
            service.location.latitude,
            service.location.longitude,
            lastScheduled.location.latitude,
            lastScheduled.location.longitude,
          )

          // Try to find a valid time slot
          const { time } = await findBestTimeSlot(
            service,
            currentCluster,
            clusterStartTime,
            distanceBias,
          )

          if (!time) continue // No valid time slot found

          // Check if adding this service would violate constraints
          const wouldExceedTimeLimit =
            new Date(time).getTime() +
              service.time.duration * 60000 -
              clusterStartTime.getTime() >
            eightHours

          // Use maxPoints from state or default
          const wouldExceedSizeLimit = currentCluster.length >= maxPoints

          if (wouldExceedTimeLimit || wouldExceedSizeLimit) continue

          // Score this service based on distance bias
          let score
          if (distanceBias === 0) {
            score = Math.abs(
              new Date(time) - new Date(lastScheduled.time.visited),
            )
          } else if (distanceBias === 100) {
            score = distance
          } else {
            const distanceWeight = distanceBias / 100
            const timeWeight = 1 - distanceWeight
            score =
              timeWeight *
              Math.abs(new Date(time) - new Date(lastScheduled.time.visited)) +
              distanceWeight * distance * 60000 // Convert to milliseconds
          }

          if (score < bestScore) {
            bestScore = score
            bestService = service
            bestTime = time
          }
        }

        if (!bestService) break // No more services can be added to this cluster

        // Add best service to current cluster
        bestService.time.visited = bestTime.toISOString()
        currentCluster.push(bestService)
        schedulableServices.splice(
          schedulableServices.findIndex(s => s.id === bestService.id),
          1,
        )
      }

      // Use minPoints from state or default
      if (currentCluster.length >= minPoints) {
        clusters.push([...currentCluster])
      } else {
        // If cluster is too small, put services back in schedulable pool
        schedulableServices.push(...currentCluster)
      }
    }

    // Update cluster numbers and sequence numbers
    const scheduledServices = clusters.flatMap((cluster, clusterIndex) =>
      cluster.map((service, serviceIndex) => ({
        ...service,
        cluster: clusterIndex + 1,
        sequenceNumber: serviceIndex + 1,
      })),
    )

    return [...scheduledServices, ...unscheduledServices]
  } catch (error) {
    if (error.message === 'SCHEDULING_TIMEOUT') {
      // Return original services unchanged if we timeout
      return services
    }
    throw error
  }
}

export async function findBestTimeSlot(
  service,
  scheduledServices,
  firstServiceStart,
  distanceBias,
) {
  const timeRange = service.time.range.map(t => new Date(t))
  let bestTime = null
  let bestScore = Number.POSITIVE_INFINITY
  let bestReason = ''

  // Check 8-hour window constraint first
  if (!isWithinTimeWindow(firstServiceStart, timeRange[0])) {
    return {
      time: null,
      isOutOfRange: true,
      reason: 'Service would exceed 8-hour window',
    }
  }

  // If this is the first service, try preferred time first
  if (scheduledServices.length === 0) {
    const preferred = new Date(service.time.preferred)
    if (preferred >= timeRange[0] && preferred <= timeRange[1]) {
      return {
        time: preferred,
        isOutOfRange: false,
        reason: 'First service scheduled at preferred time',
      }
    }
    return {
      time: timeRange[0],
      isOutOfRange: false,
      reason: 'First service scheduled at earliest possible time',
    }
  }

  // Get last scheduled service for comparison
  const startTime = Date.now()
  const lastScheduled = scheduledServices[scheduledServices.length - 1]

  for (
    let time = timeRange[0];
    time <= timeRange[1];
    time = new Date(time.getTime() + 15 * 60000)
  ) {
    // Check timeout
    if (Date.now() - startTime > 500) {
      console.log('Initial scheduling timeout reached, using best time found')
      break
    }

    if (!canScheduleService(service, scheduledServices, time)) continue

    const timeGap =
      Math.abs(
        time.getTime() -
          (new Date(lastScheduled.time.visited).getTime() +
            lastScheduled.time.duration * 60000),
      ) /
      (60 * 1000) // Convert to minutes

    const distance = calculateTravelTime(
      service.location.latitude,
      service.location.longitude,
      lastScheduled.location.latitude,
      lastScheduled.location.longitude,
    )

    // New scoring logic with even more conservative high-end scaling
    let score
    let reason

    // Convert distanceBias to a decimal (0-1) and apply an even more conservative smoothing function
    const normalizedBias = distanceBias / 100

    // More aggressive scaling reduction for high values:
    // - 0-80%: Normal scale from 0.1 to 0.5
    // - 80-90%: Slower scale from 0.5 to 0.6
    // - 90-100%: Very slow scale from 0.6 to 0.65
    let smoothBias
    if (normalizedBias > 0.9) {
      smoothBias = 0.6 + (normalizedBias - 0.9) * 0.05 // Very gentle slope for 90-100%
    } else if (normalizedBias > 0.8) {
      smoothBias = 0.5 + (normalizedBias - 0.8) * 0.1 // Gentle slope for 80-90%
    } else {
      smoothBias = 0.1 + normalizedBias * 0.5 // Normal slope up to 80%
    }

    // Add hard limits to prevent excessive computation
    const MAX_TIME_GAP = 180 // 3 hours max time gap to consider
    const MAX_DISTANCE = 30 // 30 miles max distance to consider

    // Normalize both factors to similar scales with hard limits
    const normalizedTimeGap = Math.min(timeGap, MAX_TIME_GAP) / MAX_TIME_GAP
    const normalizedDistance = Math.min(distance, MAX_DISTANCE) / MAX_DISTANCE

    score =
      (1 - smoothBias) * normalizedTimeGap + smoothBias * normalizedDistance
    reason = `Balanced score: ${(1 - smoothBias).toFixed(2)} time weight, ${smoothBias.toFixed(2)} distance weight`

    if (score < bestScore) {
      bestScore = score
      bestTime = time
      bestReason = reason
      service.schedulingReason = reason // Store reason for logging
    }
  }

  // If we couldn't find a slot, try shifting adjacent services
  if (!bestTime) {
    const shiftResult = await tryShiftAdjacentServices(
      service,
      scheduledServices,
      firstServiceStart,
      distanceBias,
    )
    if (shiftResult?.time) {
      bestTime = shiftResult.time
      bestReason = `Shifted adjacent services to fit: ${shiftResult.reason}`
      service.schedulingReason = bestReason
    }
  }

  return {
    time: bestTime ? new Date(bestTime) : null,
    isOutOfRange: false,
    reason: bestReason,
  }
}

export async function scheduleClusteredServices(
  services,
  clusterUnclustered = false,
  distanceBias = 50,
) {
  const eightHours = 8 * 60 * 60 * 1000
  const clusters = []
  const unscheduledServices = []

  // Add logging to see what services we're working with
  console.log(`Processing ${services.length} total services`)

  // Group services by cluster and time window
  const servicesByCluster = services.reduce((acc, service) => {
    // Log each service's time window
    if (service.cluster === -2) {
      unscheduledServices.push({
        ...service,
        clusterReason: 'Outlier',
      })
      return acc
    }

    if (service.cluster === -1 && !clusterUnclustered) {
      unscheduledServices.push({
        ...service,
        clusterReason: 'Not clustered',
      })
      return acc
    }

    // Group by both cluster and time window (AM/PM)
    const timeWindow =
      new Date(service.time.preferred).getHours() < 12 ? 'AM' : 'PM'
    const cluster = service.cluster === -1 ? 'unclustered' : service.cluster
    const key = `${cluster}-${timeWindow}`

    if (!acc[key]) acc[key] = []
    acc[key].push(service)
    return acc
  }, {})

  // Process each cluster group
  for (const [clusterKey, clusterServices] of Object.entries(
    servicesByCluster,
  )) {
    console.log(
      `Processing cluster ${clusterKey} with ${clusterServices.length} services`,
    )

    const currentCluster = []
    const schedulableServices = [...clusterServices]

    // Find service with earliest preferred time in this group
    const firstService = schedulableServices.reduce((earliest, current) => {
      const earliestTime = new Date(earliest.time.preferred)
      const currentTime = new Date(current.time.preferred)
      return currentTime < earliestTime ? current : earliest
    }, schedulableServices[0])

    const clusterStartTime = new Date(firstService.time.preferred)
    firstService.time.visited = clusterStartTime.toISOString()
    currentCluster.push(firstService)

    schedulableServices.splice(
      schedulableServices.findIndex(s => s.id === firstService.id),
      1,
    )

    // Schedule remaining services in cluster
    while (schedulableServices.length > 0) {
      let bestService = null
      let bestTime = null
      let bestScore = Number.POSITIVE_INFINITY

      const lastScheduled = currentCluster[currentCluster.length - 1]

      // Process each remaining service
      for (const service of schedulableServices) {
        // Get distance from Redis
        const distance = await getDistance(service, lastScheduled)

        const timeRange = service.time.range.map(t => new Date(t))
        for (
          let time = timeRange[0];
          time <= timeRange[1];
          time = new Date(time.getTime() + 15 * 60000)
        ) {
          if (!canScheduleService(service, currentCluster, time)) continue

          const wouldExceedTimeLimit =
            time.getTime() +
              service.time.duration * 60000 -
              clusterStartTime.getTime() >
            eightHours

          if (wouldExceedTimeLimit) continue

          const timeGap =
            Math.abs(
              time.getTime() -
                (new Date(lastScheduled.time.visited).getTime() +
                  lastScheduled.time.duration * 60000),
            ) /
            (60 * 1000)

          let score
          if (distanceBias === 0) {
            score = timeGap
          } else if (distanceBias === 100) {
            score = distance * 1000 + timeGap / 1000
          } else {
            const distanceWeight = distanceBias / 100
            const timeWeight = 1 - distanceWeight
            score = timeWeight * timeGap + distanceWeight * distance * 60
          }

          if (score < bestScore) {
            bestScore = score
            bestService = service
            bestTime = time
          }
        }
      }

      if (!bestService) break

      bestService.time.visited = bestTime.toISOString()
      currentCluster.push(bestService)
      schedulableServices.splice(
        schedulableServices.findIndex(s => s.id === bestService.id),
        1,
      )
    }

    if (currentCluster.length > 0) {
      clusters.push([...currentCluster])
    }
  }

  const scheduledServices = clusters.flatMap((cluster, clusterIndex) =>
    cluster.map((service, serviceIndex) => ({
      ...service,
      cluster: clusterIndex + 1,
      sequenceNumber: serviceIndex + 1,
    })),
  )

  // Log final results
  console.log(`Scheduled ${scheduledServices.length} services`)
  console.log(`Left ${unscheduledServices.length} services unscheduled`)

  return [...scheduledServices, ...unscheduledServices]
}
