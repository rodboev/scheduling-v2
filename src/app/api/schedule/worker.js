import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { areSameBorough } from '../../utils/boroughs.js'
import {
  MAX_RADIUS_MILES_ACROSS_BOROUGHS,
  HARD_MAX_RADIUS_MILES,
  SHIFT_DURATION,
  SHIFT_DURATION_MS,
  ENFORCE_BOROUGH_BOUNDARIES,
  TECH_SPEED_MPH,
  MAX_TIME_SEARCH,
  MAX_MERGE_ATTEMPTS,
  MERGE_CLOSEST_SHIFTS,
  TECH_START_TIME_VARIANCE,
  LONG_SERVICE_THRESHOLD,
  MIN_BUFFER_BETWEEN_SERVICES,
} from '../../utils/constants.js'
import { getBorough } from '../../utils/boroughs.js'
import { calculateTravelTime } from '../../map/utils/travelTime.js'
import dayjs from 'dayjs'
import { findShiftGaps, canFitInGap, findGaps } from '../../utils/gaps.js'

const SCORE_CACHE = new Map() // Cache for service compatibility scores

// Track tech start times across days
const techStartTimes = new Map()

// Constants at the top of the file
const HOURS_PER_SHIFT = 8

// Rest period constants
const MIN_REST_HOURS = 14
const TARGET_REST_HOURS = 16
const MIN_REST_MS = MIN_REST_HOURS * 60 * 60 * 1000
const TARGET_REST_MS = TARGET_REST_HOURS * 60 * 60 * 1000

function parseDate(dateStr) {
  const date = new Date(dateStr)
  return isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  if (!date || isNaN(date.getTime())) return null
  return date.toISOString()
}

function isValidTimeRange(start, end) {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return false
  return start < end && end - start <= SHIFT_DURATION * 60 * 60 * 1000
}

// Check if two service execution times overlap (including their durations)
function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  const existingStartMs = existingStart.getTime()
  const existingEndMs = existingEnd.getTime()
  const newStartMs = newStart.getTime()
  const newEndMs = newEnd.getTime()

  // Services overlap if one starts before the other ends
  return newStartMs < existingEndMs && existingStartMs < newEndMs
}

// Validate that a service doesn't overlap with any existing services in the shift
function validateNoOverlaps(shift, newService, tryStart) {
  const tryEnd = new Date(tryStart.getTime() + newService.time.duration * 60000)
  
  // Check for overlaps with all existing services
  for (const existingService of shift.services) {
    if (checkTimeOverlap(
      new Date(existingService.start),
      new Date(existingService.end),
      tryStart,
      tryEnd
    )) {
      return false
    }
  }
  
  return true
}

function getTimeWindowOverlapScore(service, shiftServices) {
  const nextEarliestStart = new Date(service.time.range[0])
  const nextLatestStart = new Date(service.time.range[1])
  const nextDuration = service.time.duration * 60 * 1000

  let totalOverlap = 0
  for (const existing of shiftServices) {
    const existingEarliestStart = new Date(existing.time.range[0])
    const existingLatestStart = new Date(existing.time.range[1])
    const existingDuration = existing.time.duration * 60 * 1000

    // Check both directions:
    // 1. Can this service start before existing service ends?
    // 2. Can this service end before existing service starts?
    const overlapStart = Math.max(nextEarliestStart, existingEarliestStart)
    const overlapEnd = Math.min(
      new Date(nextLatestStart.getTime() + nextDuration),
      new Date(existingLatestStart.getTime() + existingDuration)
    )

    if (overlapEnd > overlapStart) {
      const overlap = (overlapEnd - overlapStart) / (60 * 1000) // Convert to minutes
      totalOverlap += overlap
    }
  }

  return totalOverlap / (SHIFT_DURATION / 2)
}

function getCacheKey(service1, service2) {
  return `${service1.originalIndex}-${service2.originalIndex}`
}

function calculateServiceScore(
  service,
  lastService,
  distance,
  travelTime,
  scheduledServices,
  remainingServices,
  distanceMatrix
) {
  const cacheKey = getCacheKey(service, lastService)
  if (SCORE_CACHE.has(cacheKey)) {
    const cachedScore = SCORE_CACHE.get(cacheKey)
    return cachedScore
  }

  // Quick distance check
  if (!distance || distance > HARD_MAX_RADIUS_MILES) {
    return -Infinity
  }

  // Distance score - penalize longer distances exponentially
  const distanceScore = -Math.pow(distance / HARD_MAX_RADIUS_MILES, 2) * 50

  // Time window overlap score
  const timeWindowOverlap = getTimeWindowOverlapScore(service, scheduledServices)

  // Preferred time score
  const tryStart = new Date(lastService.end)
  const preferredTime = new Date(service.time.preferred)
  const preferredDiff = Math.abs(tryStart - preferredTime) / 60000
  const preferredScore = -Math.log(preferredDiff + 1)

  // Simplified future compatibility - only check immediate next service
  let futureScore = 0
  if (remainingServices.length > 0) {
    const nextService = remainingServices[0]
    const nextDistance = getDistance(service, nextService, distanceMatrix)

    if (nextDistance && nextDistance <= HARD_MAX_RADIUS_MILES) {
      const nextTravelTime = calculateTravelTime(nextDistance)
      const serviceEnd = new Date(tryStart.getTime() + service.time.duration * 60000)
      const earliestNextStart = new Date(serviceEnd.getTime() + nextTravelTime * 60000)
      const nextRangeStart = new Date(nextService.time.range[0])
      const nextRangeEnd = new Date(nextService.time.range[1])

      if (earliestNextStart <= nextRangeEnd) {
        const fitScore = nextRangeStart >= earliestNextStart ? 1 : 0.5
        futureScore = (1 - nextDistance / HARD_MAX_RADIUS_MILES) * fitScore
      }
    }
  }

  const score =
    distanceScore * 0.4 + timeWindowOverlap * 0.3 + preferredScore * 0.2 + futureScore * 0.1

  SCORE_CACHE.set(cacheKey, score)
  return score
}

function getDistance(service1, service2, distanceMatrix) {
  if (!service1?.location?.id || !service2?.location?.id) return null

  // Try distance matrix first
  const key = `${service1.location.id},${service2.location.id}`
  const matrixDistance = distanceMatrix[key]
  
  // Fall back to direct calculation if matrix lookup fails
  if (matrixDistance === undefined || matrixDistance === null) {
    return calculateDistance(service1, service2)
  }
  
  return matrixDistance
}

function createScheduledService(service, shift, matchInfo, distanceMatrix) {
  const lastService = shift.services[shift.services.length - 1]
  const distance = lastService ? getDistance(lastService, service, distanceMatrix) : 0
  const travelTime = distance ? calculateTravelTime(distance) : 0

  return {
    ...service,
    cluster: shift.cluster,
    sequenceNumber: shift.services.length + 1,
    start: formatDate(matchInfo.start),
    end: formatDate(new Date(matchInfo.start.getTime() + service.time.duration * 60000)),
    distanceFromPrevious: distance || 0,
    travelTimeFromPrevious: travelTime,
    previousService: lastService ? lastService.id : null,
    previousCompany: lastService ? lastService.company : null,
  }
}

function createNewShift(service, clusterIndex, remainingServices, distanceMatrix) {
  // Find optimal start time that maximizes potential services
  const shiftStart = findBestShiftStart(service, remainingServices, distanceMatrix)
  
  // Ensure shift doesn't exceed max duration
  const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION_MS)

  const techNumber = clusterIndex + 1
  const shift = {
    services: [],
    startTime: shiftStart,
    endTime: shiftEnd,
    cluster: techNumber,
    techId: `Tech ${techNumber}`,
    mergeAttempts: 0
  }

  // First service always gets placement order 1
  const scheduledService = {
    ...service,
    cluster: techNumber,
    techId: `Tech ${techNumber}`,
    placementOrder: 1
  }
  shift.services = [scheduledService]
  return shift
}

function assignTechsToShifts(shifts, dateStr) {
  // Group shifts by date
  const shiftsByDate = new Map()
  const techAssignmentsByDate = new Map()
  const totalTechs = new Set(shifts.map(s => s.techId)).size

  // Reset tech start times for new assignment
  techStartTimes.clear()

  // First, group all shifts by date
  for (const shift of shifts) {
    const shiftDate = dayjs(shift.services[0].start).format('YYYY-MM-DD')
    if (!shiftsByDate.has(shiftDate)) {
      shiftsByDate.set(shiftDate, [])
      techAssignmentsByDate.set(shiftDate, new Set())
    }
    shiftsByDate.get(shiftDate).push(shift)
  }

  // Sort all dates chronologically
  const sortedDates = Array.from(shiftsByDate.keys()).sort()
  const firstDate = sortedDates[0]

  // Sort first day's shifts by start time and assign techs sequentially
  const firstDayShifts = shiftsByDate.get(firstDate)
  firstDayShifts.sort((a, b) => new Date(a.services[0].start) - new Date(b.services[0].start))

  // First day: Assign tech numbers sequentially (Tech 1, Tech 2, etc.)
  firstDayShifts.forEach((shift, index) => {
    const techNumber = index + 1  // Tech 1, Tech 2, Tech 3...
    const techId = `Tech ${techNumber}`
    const startTime = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)
    techStartTimes.set(techId, startTime)
    shift.techId = techId
    shift.cluster = techNumber // Cluster number becomes tech number
    techAssignmentsByDate.get(firstDate).add(techId)
  })

  // Subsequent days: Try to match previous start times
  for (const date of sortedDates.slice(1)) {
    const dateShifts = shiftsByDate.get(date)
    const assignedTechs = techAssignmentsByDate.get(date)

    // Sort shifts by start time
    dateShifts.sort((a, b) => new Date(a.services[0].start) - new Date(b.services[0].start))

    // For each shift, find best matching tech based on start time
    for (const shift of dateShifts) {
      const shiftStartTime = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)
      let bestTech = null
      let bestVariance = TECH_START_TIME_VARIANCE

      // Try to find tech with closest start time
      for (const [techId, prefStartTime] of techStartTimes) {
        if (assignedTechs.has(techId)) continue
        const variance = Math.abs(shiftStartTime - prefStartTime)
        if (variance <= TECH_START_TIME_VARIANCE && variance < bestVariance) {
          bestTech = techId
          bestVariance = variance
        }
      }

      if (bestTech) {
        shift.techId = bestTech
        shift.cluster = parseInt(bestTech.replace('Tech ', '')) // Extract number from techId
        assignedTechs.add(bestTech)
      } else {
        // If no tech found within variance, create new tech
        const techNumber = techStartTimes.size + 1
        const newTechId = `Tech ${techNumber}`
        shift.techId = newTechId
        shift.cluster = techNumber
        techStartTimes.set(newTechId, shiftStartTime)
        assignedTechs.add(newTechId)
      }

      // Update all services in shift with tech ID and cluster
      shift.services.forEach(service => {
        service.techId = shift.techId
        service.cluster = shift.cluster
      })
    }
  }

  return shifts
}

function calculateDistance(service1, service2) {
  if (!service1?.location?.latitude || !service1?.location?.longitude || 
      !service2?.location?.latitude || !service2?.location?.longitude) {
    return null
  }

  const lat1 = service1.location.latitude
  const lon1 = service1.location.longitude
  const lat2 = service2.location.latitude
  const lon2 = service2.location.longitude

  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function getMeanStartTime(service) {
  const earliestStart = new Date(service.time.range[0])
  const latestStart = new Date(service.time.range[1])
  return new Date((earliestStart.getTime() + latestStart.getTime()) / 2)
}

function findBestShiftStart(service, otherServices, distanceMatrix) {
  // Calculate mean start time for initial service
  const meanStartTime = getMeanStartTime(service)
  
  // Ensure the mean start time allows for a valid 8-hour shift
  const shiftStartBound = new Date(meanStartTime.getTime() - (SHIFT_DURATION_MS / 2))
  const shiftEndBound = new Date(meanStartTime.getTime() + (SHIFT_DURATION_MS / 2))
  
  // Validate against service's actual time window
  const windowStart = new Date(service.time.range[0])
  const windowEnd = new Date(service.time.range[1])
  
  // If mean-centered shift would violate service window, adjust accordingly
  if (shiftStartBound < windowStart) {
    return windowStart
  }
  if (shiftEndBound > windowEnd) {
    return new Date(windowEnd.getTime() - SHIFT_DURATION_MS)
  }
  
  return shiftStartBound
}

function updateServiceRelationships(services, distanceMatrix) {
  // Sort services by start time
  services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  
  // Update sequence numbers and previous service info
  services.forEach((service, index) => {
    service.sequenceNumber = index + 1
    if (index > 0) {
      const prevService = services[index - 1]
      service.previousService = prevService.id
      service.previousCompany = prevService.company
      const distance = getDistance(prevService, service, distanceMatrix)
      service.distanceFromPrevious = distance || 0
      service.travelTimeFromPrevious = distance ? calculateTravelTime(distance) : 0
    } else {
      service.previousService = null
      service.previousCompany = null
      service.distanceFromPrevious = 0
      service.travelTimeFromPrevious = 0
    }
  })

  return services
}

function processServices(services, distanceMatrix) {
  try {
    const startTime = performance.now()
    SCORE_CACHE.clear()

    console.log('Worker received services:', services.length)
    
    // Track scheduled services by ID AND start time to catch duplicates with different times
    const scheduledServiceTracker = new Map() // Map<serviceId, Set<startTime>>
    
    // Pre-track any services that already have start/end times
    services.forEach(service => {
      if (service.start && service.end) {
        if (!scheduledServiceTracker.has(service.id)) {
          scheduledServiceTracker.set(service.id, new Set())
        }
        scheduledServiceTracker.get(service.id).add(new Date(service.start).getTime())
      }
    })
    
    // Group services by week
    const servicesByWeek = new Map()
    for (const service of services) {
      const startDate = new Date(service.time.range[0])
      const weekStart = new Date(startDate)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekKey = weekStart.toISOString()
      
      if (!servicesByWeek.has(weekKey)) {
        servicesByWeek.set(weekKey, [])
      }
      servicesByWeek.get(weekKey).push(service)
    }

    let allScheduledServices = []
    const processedWeeks = new Map()

    // Process each week's services
    for (const [weekKey, weekServices] of servicesByWeek) {
      console.log(`Processing week starting ${weekKey}:`, weekServices.length, 'services')
      
      // Pre-filter and deduplicate services for this week
      const validServices = preFilterServices(weekServices)
      
      // Create immutable service objects with computed properties
      const processedServices = validServices.map(service => {
        // If service already has start/end times, use those instead of computing mean time
        const serviceStartTime = service.start ? new Date(service.start) : null
        const meanStartTime = serviceStartTime || getMeanStartTime(service)
        
        return Object.freeze({
          ...service,
          meanStartTime,
          timeWindow: new Date(service.time.range[1]).getTime() - new Date(service.time.range[0]).getTime(),
          isPreScheduled: Boolean(service.start && service.end)
        })
      })

      // Sort services by time window flexibility (ascending) and pre-scheduled status
      const sortedServices = [...processedServices].sort((a, b) => {
        // Pre-scheduled services come first
        if (a.isPreScheduled && !b.isPreScheduled) return -1
        if (!a.isPreScheduled && b.isPreScheduled) return 1
        return a.timeWindow - b.timeWindow
      })

      // Separate long services
      const longServices = sortedServices.filter(s => s.isLongService)
      const regularServices = sortedServices.filter(s => !s.isLongService)

      const shifts = []
      const placementOrderByTech = new Map()

      // Helper function to check and track scheduled services
      const isServiceScheduled = (serviceId, startTime) => {
        const timeSet = scheduledServiceTracker.get(serviceId)
        if (!timeSet) return false
        return timeSet.has(startTime.getTime())
      }

      const trackScheduledService = (serviceId, startTime) => {
        if (!scheduledServiceTracker.has(serviceId)) {
          scheduledServiceTracker.set(serviceId, new Set())
        }
        scheduledServiceTracker.get(serviceId).add(startTime.getTime())
      }

      // First, schedule long services in their own shifts
      for (const service of longServices) {
        if (isServiceScheduled(service.id, service.meanStartTime)) continue
        
        const newShift = createNewShift(service, shifts.length, [], distanceMatrix)
        const scheduledService = createScheduledService(service, newShift, {
          start: service.meanStartTime,
          end: new Date(service.meanStartTime.getTime() + service.duration * 60000)
        }, distanceMatrix)
        
        newShift.services = [scheduledService]
        shifts.push(newShift)
        trackScheduledService(service.id, service.meanStartTime)
      }

      // Then schedule regular services
      for (const service of regularServices) {
        let bestMatch = null
        let bestShift = null
        let bestScore = -Infinity

        // Try existing shifts
        for (const shift of shifts) {
          if (shift.services.length >= 14) continue

          const matchInfo = tryFitServiceInShift(service, shift, shifts, distanceMatrix)
          if (matchInfo && !isServiceScheduled(service.id, matchInfo.start)) {
            const score = calculateFitScore(service, shift, matchInfo.start, service.meanStartTime, distanceMatrix)
            if (score > bestScore) {
              bestScore = score
              bestMatch = matchInfo
              bestShift = shift
            }
          }
        }

        // If no suitable shift found, create new one
        if (!bestMatch) {
          const remainingServices = regularServices.filter(s => !scheduledServiceTracker.has(s.id))
          const newShift = createNewShift(service, shifts.length, remainingServices, distanceMatrix)
          bestShift = newShift
          bestMatch = {
            start: service.meanStartTime,
            end: new Date(service.meanStartTime.getTime() + service.duration * 60000),
            score: 0
          }
          shifts.push(newShift)
        }

        // Only schedule if we haven't already scheduled this service at this time
        if (!isServiceScheduled(service.id, bestMatch.start)) {
          const techId = `Tech ${bestShift.cluster}`
          const placementOrder = (placementOrderByTech.get(techId) || 0) + 1
          placementOrderByTech.set(techId, placementOrder)

          const scheduledService = createScheduledService(service, bestShift, bestMatch, distanceMatrix)
          scheduledService.placementOrder = placementOrder
          bestShift.services.push(scheduledService)
          trackScheduledService(service.id, bestMatch.start)
        }
      }

      // Sort services within each shift by start time and update metadata
      for (const shift of shifts) {
        shift.services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        
        // Update sequence numbers and previous service info
        shift.services.forEach((service, index) => {
          service.sequenceNumber = index + 1
          if (index > 0) {
            const prevService = shift.services[index - 1]
            service.previousService = prevService.id
            service.previousCompany = prevService.company
            const distance = getDistance(prevService, service, distanceMatrix) || 0
            service.distanceFromPrevious = distance
            service.travelTimeFromPrevious = calculateTravelTime(distance)
          } else {
            service.previousService = null
            service.previousCompany = null
            service.distanceFromPrevious = 0
            service.travelTimeFromPrevious = 0
          }
        })
      }

      // Optimized shift merging
      let merged
      do {
        merged = false
        const shiftsByTime = [...shifts].sort((a, b) => {
          const aStart = new Date(a.services[0].start).getTime()
          const bStart = new Date(b.services[0].start).getTime()
          return aStart - bStart
        })

        for (let i = 0; i < shiftsByTime.length - 1; i++) {
          const shift1 = shiftsByTime[i]
          if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

          const lastService = shift1.services[shift1.services.length - 1]
          const lastEnd = new Date(lastService.end)

          // Only consider nearby shifts in time
          const mergeCandidates = findMergeCandidates(shift1, shiftsByTime, i, distanceMatrix)

          for (const shift2 of mergeCandidates) {
            // Check for duplicate services before merging
            const shift1ServiceIds = new Set(shift1.services.map(s => s.id))
            if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
              console.log('Prevented merging shifts with duplicate services')
              continue
            }

            const firstService = shift2.services[0]
            const distance = getDistance(lastService, firstService, distanceMatrix)

            if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

            const travelTime = calculateTravelTime(distance)
            const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

            if (earliestStart > new Date(firstService.time.range[1])) continue

            const totalServices = shift1.services.length + shift2.services.length
            if (totalServices > 14) continue

            const combinedServices = [...shift1.services, ...shift2.services]
            const workingDuration = calculateWorkingDuration(combinedServices)

            if (workingDuration > SHIFT_DURATION) continue

            // Get the highest placement order from shift1
            const maxPlacementOrder = Math.max(...shift1.services.map(s => s.placementOrder || 0))

            // If we get here, merge is possible
            const adjustedFirstService = {
              ...firstService,
              cluster: shift1.cluster,
              techId: shift1.techId,
              placementOrder: maxPlacementOrder + 1,
              start: formatDate(earliestStart),
              end: formatDate(new Date(earliestStart.getTime() + firstService.time.duration * 60000)),
              distanceFromPrevious: distance,
              travelTimeFromPrevious: travelTime,
              previousService: lastService.id,
              previousCompany: lastService.company,
            }

            const remainingServices = shift2.services.slice(1).map((service, index) => {
              const prev = index === 0 ? adjustedFirstService : shift2.services[index]
              const dist = getDistance(prev, service, distanceMatrix)
              const travel = calculateTravelTime(dist)
              return {
                ...service,
                cluster: shift1.cluster,
                techId: shift1.techId,
                placementOrder: maxPlacementOrder + 2 + index,
                distanceFromPrevious: dist,
                travelTimeFromPrevious: travel,
                previousService: prev.id,
                previousCompany: prev.company,
              }
            })

            shift1.services = [...shift1.services, adjustedFirstService, ...remainingServices]
            shift1.mergeAttempts++
            shift2.mergeAttempts++
            shifts.splice(shifts.indexOf(shift2), 1)
            merged = true
            break
          }
          if (merged) break
        }
      } while (merged)

      // Assign techs consistently across the week
      const shiftsWithTechs = assignTechsToShifts(shifts, weekKey)
      
      // Store the processed week
      processedWeeks.set(weekKey, shiftsWithTechs)
      
      // Add services to overall list
      const weekScheduledServices = shiftsWithTechs.flatMap(shift => {
        const updatedServices = updateServiceRelationships(shift.services, distanceMatrix)
        return updatedServices.map(service => ({
          ...service,
          techId: shift.techId,
          cluster: shift.cluster || -1
        }))
      })
      
      allScheduledServices = [...allScheduledServices, ...weekScheduledServices]
    }

    // Calculate final clustering info
    const clusters = new Set(allScheduledServices.map(s => s.cluster).filter(c => c >= 0))
    console.log('Found clusters:', Array.from(clusters))

    return {
      scheduledServices: allScheduledServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(performance.now() - startTime),
        connectedPointsCount: allScheduledServices.length,
        totalClusters: clusters.size,
        clusterDistribution: Array.from(clusters).map(c => ({
          [c]: allScheduledServices.filter(s => s.cluster === c).length,
        })),
        techAssignments: Object.fromEntries(
          Array.from(new Set(allScheduledServices.map(s => s.techId))).map(techId => [
            techId,
            {
              services: allScheduledServices.filter(s => s.techId === techId).length,
              startTime: techStartTimes.get(techId),
            },
          ]),
        ),
      },
    }
  } catch (error) {
    console.error('Error in worker:', error)
    throw error
  }
}

function canMergeShifts(shift1, shift2, distanceMatrix) {
  // First check for duplicate services
  const shift1ServiceIds = new Set(shift1.services.map(s => s.id))
  if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
    return false
  }

  // Rest of existing validation...
  return true
}

function tryMergeShifts(shifts, distanceMatrix) {
  let merged = false
  
  do {
    merged = false
    for (let i = 0; i < shifts.length - 1; i++) {
      const shift1 = shifts[i]
      if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

      // Create a Set of service IDs in shift1
      const shift1ServiceIds = new Set(shift1.services.map(s => s.id))

      const lastService = shift1.services[shift1.services.length - 1]
      const lastEnd = new Date(lastService.end)

      for (let j = i + 1; j < shifts.length; j++) {
        const shift2 = shifts[j]
        if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

        // Check for duplicate services before attempting merge
        if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
          continue // Skip this merge if any service IDs overlap
        }

        const firstService = shift2.services[0]
        const distance = getDistance(lastService, firstService, distanceMatrix)

        // Rest of existing merge validation...
        if (!distance || distance > HARD_MAX_RADIUS_MILES) continue
        
        const travelTime = calculateTravelTime(distance)
        const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

        if (earliestStart > new Date(firstService.time.range[1])) continue

        const totalServices = shift1.services.length + shift2.services.length
        if (totalServices > 14) continue

        const combinedServices = [...shift1.services, ...shift2.services]
        const workingDuration = calculateWorkingDuration(combinedServices)

        if (workingDuration > SHIFT_DURATION) continue

        // If we get here, merge is possible and we know services are unique
        // ... rest of merge logic ...
      }
    }
  } while (merged)

  return merged
}

function findMergeCandidates(shift1, shifts, currentIndex, distanceMatrix) {
  // Create a snapshot of all service IDs in shift1 for atomic checking
  const shift1ServiceIds = new Set(shift1.services.map(s => s.id))
  
  return shifts
    .slice(currentIndex + 1)
    .filter(shift2 => {
      if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
      
      // Check for duplicate services atomically
      if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
        console.log('Prevented merge candidate with duplicate services:', 
          shift2.services.find(s => shift1ServiceIds.has(s.id)).id)
        return false
      }

      const lastService = shift1.services[shift1.services.length - 1]
      const firstService = shift2.services[0]
      const distance = getDistance(lastService, firstService, distanceMatrix)
      
      if (!distance || distance > HARD_MAX_RADIUS_MILES) return false
      
      const travelTime = calculateTravelTime(distance)
      const lastEnd = new Date(lastService.end)
      const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)
      
      // Check if merge would create overlapping services
      const wouldOverlap = shift2.services.some(s2 => 
        shift1.services.some(s1 => 
          checkTimeOverlap(
            new Date(s1.start),
            new Date(s1.end),
            new Date(s2.start),
            new Date(s2.end)
          )
        )
      )
      
      if (wouldOverlap) {
        console.log('Prevented merge that would create time overlaps')
        return false
      }
      
      return earliestStart <= new Date(firstService.time.range[1])
    })
    .sort((a, b) => {
      const aStart = new Date(a.services[0].time.range[0])
      const bStart = new Date(b.services[0].time.range[0])
      return aStart - bStart
    })
    .slice(0, MERGE_CLOSEST_SHIFTS)
}

function initializeShifts(services) {
  // Sort all services by their earliest possible start time first
  return services
    .sort((a, b) => {
      const aEarliestStart = new Date(a.time.range[0])
      const bEarliestStart = new Date(b.time.range[0])
      return aEarliestStart - bEarliestStart
    })
    .map(service => ({
      services: [{ ...service, cluster: -1 }], // Start with -1, will assign cluster numbers as we merge
      mergeAttempts: 0
    }))
}

function clusterServices(services, distanceMatrix) {
  let currentCluster = 0
  const shiftsByTime = initializeShifts(services)
  
  // First pass - try to merge services based on earliest possible start times
  for (let i = 0; i < shiftsByTime.length; i++) {
    const shift = shiftsByTime[i]
    if (shift.services[0].cluster === -1) {
      // Start new cluster
      shift.services[0].cluster = currentCluster
    }

    let merged = false
    const mergeCandidates = findMergeCandidates(shift, shiftsByTime, i, distanceMatrix)
    
    for (const candidate of mergeCandidates) {
      const mergedShift = mergeShifts(shift, candidate, distanceMatrix)
      if (mergedShift) {
        shiftsByTime[i] = mergedShift
        merged = true
        break
      }
    }

    if (!merged) {
      currentCluster++
    }
  }

  return shiftsByTime
}

function calculateFitScore(service, shift, tryStart, meanStartTime, distanceMatrix) {
  // Score based on how close we got to the mean start time (80% weight)
  const meanTimeDeviation = Math.abs(tryStart.getTime() - meanStartTime.getTime())
  const timeScore = 1 - (meanTimeDeviation / (4 * 60 * 60 * 1000)) // Normalize to 4 hour max deviation
  
  // Get previous and next services for distance scoring (20% weight)
  const prevService = shift.services
    .filter(s => new Date(s.end).getTime() <= tryStart.getTime())
    .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0]
    
  const nextService = shift.services
    .filter(s => new Date(s.start).getTime() >= new Date(tryStart.getTime() + service.duration * 60000).getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]

  // Calculate distance scores
  let distanceScore = 1
  if (prevService) {
    const prevDistance = getDistance(prevService, service, distanceMatrix)
    if (prevDistance > HARD_MAX_RADIUS_MILES) return -Infinity
    distanceScore *= 1 - (prevDistance / HARD_MAX_RADIUS_MILES)
  }
  if (nextService) {
    const nextDistance = getDistance(service, nextService, distanceMatrix)
    if (nextDistance > HARD_MAX_RADIUS_MILES) return -Infinity
    distanceScore *= 1 - (nextDistance / HARD_MAX_RADIUS_MILES)
  }

  // Combine scores with new weights: 80% mean time, 20% distance
  return timeScore * 0.8 + distanceScore * 0.2
}

function validateTravelTimes(service, shift, tryStart, distanceMatrix) {
  const tryEnd = new Date(tryStart.getTime() + service.duration * 60000)
  
  // Find previous and next services
  const prevService = shift.services
    .filter(s => new Date(s.end).getTime() <= tryStart.getTime())
    .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0]
    
  const nextService = shift.services
    .filter(s => new Date(s.start).getTime() >= tryEnd.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]

  // Check travel time from previous service
  if (prevService) {
    const prevDistance = getDistance(prevService, service, distanceMatrix)
    if (prevDistance > HARD_MAX_RADIUS_MILES) return false
    
    const prevTravelTime = calculateTravelTime(prevDistance)
    const earliestPossibleStart = new Date(new Date(prevService.end).getTime() + prevTravelTime * 60000)
    if (tryStart < earliestPossibleStart) return false
  }

  // Check travel time to next service
  if (nextService) {
    const nextDistance = getDistance(service, nextService, distanceMatrix)
    if (nextDistance > HARD_MAX_RADIUS_MILES) return false
    
    const nextTravelTime = calculateTravelTime(nextDistance)
    const latestPossibleEnd = new Date(new Date(nextService.start).getTime() - nextTravelTime * 60000)
    if (tryEnd > latestPossibleEnd) return false
  }

  // Check borough boundaries if enforced
  if (ENFORCE_BOROUGH_BOUNDARIES && shift.services.length > 0) {
    const lastService = shift.services[shift.services.length - 1]
    if (!areSameBorough(
      lastService.location.latitude,
      lastService.location.longitude,
      service.location.latitude,
      service.location.longitude
    )) {
      const distance = getDistance(lastService, service, distanceMatrix)
      if (distance > MAX_RADIUS_MILES_ACROSS_BOROUGHS) return false
    }
  }

  return true
}

function canAddServiceToShift(service, shift, existingShifts, distanceMatrix) {
  const serviceDuration = service.duration * 60000
  const serviceStart = new Date(service.start)
  const serviceEnd = new Date(serviceStart.getTime() + serviceDuration)

  // Check if this service would make shift too long
  const shiftServices = [...shift.services, { start: service.start, end: service.end }]
  shiftServices.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  
  const firstServiceStart = new Date(shiftServices[0].start)
  const lastServiceEnd = new Date(shiftServices[shiftServices.length - 1].end)
  
  // Calculate actual working duration including this service
  const workingDuration = calculateWorkingDuration(shiftServices)
  if (workingDuration > SHIFT_DURATION) {
    return false
  }

  // Validate no overlaps with existing services
  for (const existingService of shift.services) {
    const existingStart = new Date(existingService.start)
    const existingEnd = new Date(existingService.end)
    
    if (checkTimeOverlap(existingStart, existingEnd, serviceStart, serviceEnd)) {
      return false
    }
  }

  // Check rest periods against other shifts for this tech
  for (const otherShift of existingShifts) {
    if (otherShift === shift) continue
    if (otherShift.techId !== shift.techId) continue

    const otherServices = otherShift.services
    if (!otherServices.length) continue

    const otherStart = new Date(Math.min(...otherServices.map(s => new Date(s.start).getTime())))
    const otherEnd = new Date(Math.max(...otherServices.map(s => new Date(s.end).getTime())))

    // Calculate rest periods
    const restAfter = otherStart.getTime() - serviceEnd.getTime()
    const restBefore = serviceStart.getTime() - otherEnd.getTime()

    // If rest period is less than minimum (14 hours), reject
    if (restAfter > 0 && restAfter < MIN_REST_MS) return false
    if (restBefore > 0 && restBefore < MIN_REST_MS) return false

    // If rest period is between 14-16 hours, only accept if no services are available
    // in the target window (16-18 hours later)
    if (restAfter > 0 && restAfter < TARGET_REST_MS) {
      const targetWindowStart = new Date(serviceEnd.getTime() + TARGET_REST_MS)
      const targetWindowEnd = new Date(serviceEnd.getTime() + TARGET_REST_MS + SHIFT_DURATION_MS)
      
      const hasServicesInTargetWindow = shift.services.some(s => {
        const serviceTimeStart = new Date(s.time.range[0])
        const serviceTimeEnd = new Date(s.time.range[1])
        return (serviceTimeStart <= targetWindowEnd && serviceTimeEnd >= targetWindowStart)
      })

      if (hasServicesInTargetWindow) return false
    }

    if (restBefore > 0 && restBefore < TARGET_REST_MS) {
      const targetWindowStart = new Date(otherEnd.getTime() + TARGET_REST_MS)
      const targetWindowEnd = new Date(otherEnd.getTime() + TARGET_REST_MS + SHIFT_DURATION_MS)
      
      const hasServicesInTargetWindow = shift.services.some(s => {
        const serviceTimeStart = new Date(s.time.range[0])
        const serviceTimeEnd = new Date(s.time.range[1])
        return (serviceTimeStart <= targetWindowEnd && serviceTimeEnd >= targetWindowStart)
      })

      if (hasServicesInTargetWindow) return false
    }
  }

  return true
}

function tryFitServiceInShift(service, shift, shifts, distanceMatrix) {
  // Create a snapshot of current service IDs in the shift for atomic checking
  const currentShiftServiceIds = new Set(shift.services.map(s => s.id))
  const currentTechServiceIds = new Set()
  
  // Gather all service IDs for this tech on this day
  const serviceDate = dayjs(service.time.range[0]).format('YYYY-MM-DD')
  shifts.forEach(otherShift => {
    if (otherShift.techId === shift.techId) {
      otherShift.services.forEach(s => {
        const otherDate = dayjs(s.time.range[0]).format('YYYY-MM-DD')
        if (serviceDate === otherDate) {
          currentTechServiceIds.add(s.id)
        }
      })
    }
  })

  // Atomic duplicate checking
  if (currentShiftServiceIds.has(service.id)) {
    console.log('Prevented duplicate service in shift (atomic check):', service.id, shift.techId)
    return null
  }

  if (currentTechServiceIds.has(service.id)) {
    console.log('Prevented duplicate service for tech on same day (atomic check):', service.id, shift.techId)
    return null
  }

  const serviceDuration = service.duration * 60000
  const timeWindowStart = new Date(service.time.range[0])
  const timeWindowEnd = new Date(service.time.range[1])
  
  // Helper function to validate time window
  const isWithinTimeWindow = (tryStart, tryEnd) => {
    // Both start and end must be within the original time window
    return tryStart >= timeWindowStart && 
           tryStart <= timeWindowEnd &&
           tryEnd >= timeWindowStart &&
           tryEnd <= timeWindowEnd
  }
  
  // If this is the first service in the shift, use mean time
  if (shift.services.length === 0) {
    const meanStartTime = service.meanStartTime
    const tryStart = new Date(meanStartTime)
    const tryEnd = new Date(tryStart.getTime() + serviceDuration)
    
    // Verify this time window works
    if (isWithinTimeWindow(tryStart, tryEnd)) {
      const mockService = { ...service, start: tryStart, end: tryEnd }
      if (!canAddServiceToShift(mockService, shift, shifts, distanceMatrix)) {
        return null
      }

      // Double-check no duplicates were added while we were checking
      if (currentShiftServiceIds.has(service.id) || currentTechServiceIds.has(service.id)) {
        console.log('Late duplicate detection prevented service addition:', service.id)
        return null
      }

      return {
        start: tryStart,
        end: tryEnd,
        score: 1
      }
    }
    return null
  }
  
  // For subsequent services, try to pack tightly before or after existing services
  const sortedServices = [...shift.services].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
  
  // Try each possible placement, checking rest periods
  const tryPlacements = []

  // Try before first
  const firstService = sortedServices[0]
  const firstServiceStart = new Date(firstService.start)
  const distance = getDistance(service, firstService, distanceMatrix)
  
  if (distance <= HARD_MAX_RADIUS_MILES) {
    const travelTime = calculateTravelTime(distance)
    const tryEndTime = new Date(firstServiceStart.getTime() - (travelTime * 60000))
    const tryStartTime = new Date(tryEndTime.getTime() - serviceDuration)
    
    if (isWithinTimeWindow(tryStartTime, tryEndTime)) {
      const mockService = { ...service, start: tryStartTime, end: tryEndTime }
      
      // Verify no overlaps AND no duplicates atomically
      if (canAddServiceToShift(mockService, shift, shifts, distanceMatrix) &&
          !currentShiftServiceIds.has(service.id) && 
          !currentTechServiceIds.has(service.id)) {
        const score = calculateFitScore(service, shift, tryStartTime, service.meanStartTime, distanceMatrix)
        if (score > -Infinity) {
          tryPlacements.push({
            start: tryStartTime,
            end: tryEndTime,
            score
          })
        }
      }
    }
  }

  // Try after last
  const lastService = sortedServices[sortedServices.length - 1]
  const lastServiceEnd = new Date(lastService.end)
  const lastDistance = getDistance(lastService, service, distanceMatrix)
  
  if (lastDistance <= HARD_MAX_RADIUS_MILES) {
    const travelTime = calculateTravelTime(lastDistance)
    const tryStartTime = new Date(lastServiceEnd.getTime() + (travelTime * 60000))
    const tryEndTime = new Date(tryStartTime.getTime() + serviceDuration)
    
    if (isWithinTimeWindow(tryStartTime, tryEndTime)) {
      const mockService = { ...service, start: tryStartTime, end: tryEndTime }
      
      // Verify no overlaps AND no duplicates atomically
      if (canAddServiceToShift(mockService, shift, shifts, distanceMatrix) &&
          !currentShiftServiceIds.has(service.id) && 
          !currentTechServiceIds.has(service.id)) {
        const score = calculateFitScore(service, shift, tryStartTime, service.meanStartTime, distanceMatrix)
        if (score > -Infinity) {
          tryPlacements.push({
            start: tryStartTime,
            end: tryEndTime,
            score
          })
        }
      }
    }
  }

  // Try to fit between existing services
  for (let i = 0; i < sortedServices.length - 1; i++) {
    const beforeService = sortedServices[i]
    const afterService = sortedServices[i + 1]
    
    const beforeEnd = new Date(beforeService.end)
    const afterStart = new Date(afterService.start)
    
    // Calculate required travel times
    const distanceFromBefore = getDistance(beforeService, service, distanceMatrix)
    const distanceToAfter = getDistance(service, afterService, distanceMatrix)
    
    if (distanceFromBefore > HARD_MAX_RADIUS_MILES || distanceToAfter > HARD_MAX_RADIUS_MILES) {
      continue
    }
    
    const travelTimeFromBefore = calculateTravelTime(distanceFromBefore)
    const travelTimeToAfter = calculateTravelTime(distanceToAfter)
    
    // Calculate earliest possible start after previous service
    const earliestStart = new Date(beforeEnd.getTime() + (travelTimeFromBefore * 60000))
    // Calculate latest possible end before next service
    const latestEnd = new Date(afterStart.getTime() - (travelTimeToAfter * 60000))
    
    // Check if service duration fits in this gap
    if (latestEnd.getTime() - earliestStart.getTime() >= serviceDuration) {
      // Try to place as early as possible in the gap while respecting time window
      let tryStartTime = earliestStart
      if (tryStartTime < timeWindowStart) {
        tryStartTime = new Date(timeWindowStart)
      }
      
      const tryEndTime = new Date(tryStartTime.getTime() + serviceDuration)
      
      if (isWithinTimeWindow(tryStartTime, tryEndTime) && tryEndTime <= latestEnd) {
        const mockService = { ...service, start: tryStartTime, end: tryEndTime }
        if (canAddServiceToShift(mockService, shift, shifts, distanceMatrix)) {
          const score = calculateFitScore(service, shift, tryStartTime, service.meanStartTime, distanceMatrix)
          if (score > -Infinity) {
            tryPlacements.push({
              start: tryStartTime,
              end: tryEndTime,
              score
            })
          }
        }
      }
    }
  }

  // Return the best valid placement
  if (tryPlacements.length > 0) {
    return tryPlacements.reduce((best, current) => 
      current.score > best.score ? current : best
    )
  }

  return null
}

function preFilterServices(services) {
  const serviceMap = new Map()
  const duplicates = new Set()
  const techDayServices = new Map() // Track services by tech and day

  services.forEach(service => {
    // Check for exact duplicates first
    if (serviceMap.has(service.id)) {
      duplicates.add(service.id)
      console.log('Worker found duplicate service:', service.id)
      return
    }

    // Create a key for tech+day tracking
    const serviceDate = dayjs(service.time.range[0]).format('YYYY-MM-DD')
    const techDayKey = `${service.tech.code}_${serviceDate}`
    
    // Track services by tech and day
    if (!techDayServices.has(techDayKey)) {
      techDayServices.set(techDayKey, new Set())
    }
    
    // If this service ID already exists for this tech on this day, skip it
    if (techDayServices.get(techDayKey).has(service.id)) {
      duplicates.add(service.id)
      console.log('Worker found duplicate service for tech on same day:', service.id, techDayKey)
      return
    }

    // Add service to tracking
    techDayServices.get(techDayKey).add(service.id)
    
    serviceMap.set(service.id, {
      ...service,
      duration: service.time.duration,
      isLongService: service.time.duration >= LONG_SERVICE_THRESHOLD,
      borough: getBorough(service.location.latitude, service.location.longitude)
    })
  })

  return Array.from(serviceMap.values())
}

function calculateWorkingDuration(services) {
  if (!services.length) return 0
  
  let totalDuration = 0
  for (let i = 0; i < services.length - 1; i++) {
    const current = services[i]
    const next = services[i + 1]
    
    // Add service duration
    totalDuration += current.duration
    
    // Add travel time to next service
    const travelTime = next.travelTimeFromPrevious || 0
    totalDuration += travelTime
  }
  
  // Add last service duration
  totalDuration += services[services.length - 1].duration
  
  return totalDuration
}

function tryMoveService(service, fromShift, toShift, distanceMatrix) {
  // Don't move if service already exists in target shift
  if (toShift.services.some(s => s.id === service.id)) return false

  // Check if service can fit in the target shift
  const matchInfo = tryFitServiceInShift(service, toShift, [], distanceMatrix)
  if (!matchInfo) return false

  // If we can fit it, remove from old shift and add to new shift
  fromShift.services = fromShift.services.filter(s => s.id !== service.id)
  
  const scheduledService = createScheduledService(service, toShift, matchInfo, distanceMatrix)
  toShift.services.push(scheduledService)
  
  // Sort services by start time and update relationships
  toShift.services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  updateServiceRelationships(toShift.services, distanceMatrix)

  return true
}

function optimizeShifts(shifts, distanceMatrix) {
  let improved = true
  let iterations = 0
  const MAX_ITERATIONS = 100

  while (improved && iterations < MAX_ITERATIONS) {
    improved = false
    iterations++

    // Try to move each service to a better shift
    for (const fromShift of shifts) {
      for (const service of [...fromShift.services]) {
        for (const toShift of shifts) {
          if (fromShift === toShift) continue
          if (toShift.services.length >= 14) continue

          // Try moving the service
          if (tryMoveService(service, fromShift, toShift, distanceMatrix)) {
            improved = true
            break
          }
        }
        if (improved) break
      }
      if (improved) break
    }
  }

  // Remove any empty shifts
  return shifts.filter(shift => shift.services.length > 0)
}

// Handle messages from the main thread
parentPort.on('message', async ({ services, distanceMatrix }) => {
  try {
    console.log('Worker received services:', services.length)
    console.log(
      'Distance matrix dimensions:',
      distanceMatrix.length,
      'x',
      distanceMatrix[0]?.length,
    )

    const result = await processServices(services, distanceMatrix)
    console.log('Worker processed services:', result.scheduledServices.length)
    console.log(
      'Services with clusters:',
      result.scheduledServices.filter(s => s.cluster >= 0).length,
    )

    parentPort.postMessage(result)
  } catch (error) {
    console.error('Error in clustering worker:', error)
    parentPort.postMessage({
      error: error.message,
      scheduledServices: services.map(service => ({ ...service, cluster: -1 })),
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: 0,
        connectedPointsCount: 0,
        totalClusters: 0,
        clusterSizes: [],
        clusterDistribution: [],
      },
    })
  }
})

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
