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
import { dayjsInstance as dayjs } from '../../utils/dayjs.js'
import { findShiftGaps, canFitInGap, findGaps } from '../../utils/gaps.js'

const SCORE_CACHE = new Map() // Cache for service compatibility scores

// Track placement orders by tech and day
const placementOrdersByTechDay = new Map() // Map<techId_date, number>

function getNextPlacementOrder(techId, date) {
  // Ensure consistent date format for the key
  const dayKey = dayjs(date).tz('America/New_York').format('YYYY-MM-DD')
  const key = `${techId}_${dayKey}`
  
  // Get current order, defaulting to 0
  const current = placementOrdersByTechDay.get(key) || 0
  const next = current + 1
  
  // Store the new order
  placementOrdersByTechDay.set(key, next)
  console.log(`Assigning order ${next} for tech ${techId} on ${dayKey}`)
  
  return next
}

// Track tech start times across days
const techStartTimes = new Map()

// Constants at the top of the file
const HOURS_PER_SHIFT = 8
const SHIFT_BUFFER_MINUTES = 10
const MAX_SHIFT_SPAN = (HOURS_PER_SHIFT * 60 * 60 * 1000) + (SHIFT_BUFFER_MINUTES * 60 * 1000)
const MAX_ALLOWED_GAP = 60 * 60 * 1000 // 60 minutes max gap
const MAX_PREFERRED_GAP = 45 * 60 * 1000 // 45 minutes preferred gap
const SHIFT_DENSITY_TARGET = 0.85 // Target 85% density
const TARGET_SERVICES_PER_TECH = 7 // Target number of services per tech
const MAX_SERVICES_PER_TECH = 8 // Maximum services per tech

// Rest period constants
const MIN_REST_HOURS = 14
const TARGET_REST_HOURS = 16
const MIN_REST_MS = MIN_REST_HOURS * 60 * 60 * 1000
const TARGET_REST_MS = TARGET_REST_HOURS * 60 * 60 * 1000

// Track tech assignments and workload
const techWorkload = new Map()

function getTechWorkload(techId) {
  if (!techWorkload.has(techId)) {
    techWorkload.set(techId, {
      serviceCount: 0,
      totalDuration: 0,
      shifts: new Set(),
    })
  }
  return techWorkload.get(techId)
}

function updateTechWorkload(techId, service, shiftId) {
  const workload = getTechWorkload(techId)
  workload.serviceCount++
  workload.totalDuration += service.duration
  workload.shifts.add(shiftId)
}

// Enhanced gap penalty calculation
function calculateGapPenalty(gapDuration, shift, tryStart) {
  // Base duration-based penalty
  let penalty = 0
  
  // Duration-based penalties
  if (gapDuration > MAX_ALLOWED_GAP) {
    penalty = -1000 * (gapDuration / (60 * 60 * 1000))
  } else if (gapDuration > MAX_PREFERRED_GAP) {
    penalty = -500 * (gapDuration / (60 * 60 * 1000))
  } else if (gapDuration > 30 * 60 * 1000) {
    penalty = -100 * (gapDuration / (60 * 60 * 1000))
  } else {
    penalty = -10 * (gapDuration / (60 * 60 * 1000))
  }

  // Additional pattern-based penalties
  if (shift.services.length > 0) {
    const shiftStart = Math.min(...shift.services.map(s => new Date(s.start).getTime()))
    const shiftEnd = Math.max(...shift.services.map(s => new Date(s.end).getTime()))
    const tryStartTime = new Date(tryStart).getTime()
    
    // Penalize creating new "islands" of services
    if (tryStartTime > shiftEnd + MAX_ALLOWED_GAP || 
        tryStartTime < shiftStart - MAX_ALLOWED_GAP) {
      penalty *= 2
    }
  }

  // Add workload balancing penalty
  const workload = getTechWorkload(shift.techId)
  if (workload.serviceCount >= TARGET_SERVICES_PER_TECH) {
    penalty -= 500 * (workload.serviceCount - TARGET_SERVICES_PER_TECH + 1)
  }
  if (workload.serviceCount >= MAX_SERVICES_PER_TECH) {
    penalty -= 10000 // Strong penalty for exceeding max services
  }

  return penalty
}

// Enhanced shift density calculation
function calculateShiftDensity(shift, newServiceStart, newServiceEnd) {
  const services = [...shift.services, { start: newServiceStart, end: newServiceEnd }]
  if (services.length === 0) return 1

  const shiftStart = Math.min(...services.map(s => new Date(s.start).getTime()))
  const shiftEnd = Math.max(...services.map(s => new Date(s.end).getTime()))
  const shiftDuration = shiftEnd - shiftStart

  let workingTime = 0
  let gaps = 0
  
  services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  
  for (let i = 0; i < services.length; i++) {
    const service = services[i]
    const serviceStart = new Date(service.start).getTime()
    const serviceEnd = new Date(service.end).getTime()
    
    workingTime += serviceEnd - serviceStart
    
    if (i > 0) {
      const prevEnd = new Date(services[i-1].end).getTime()
      const gap = serviceStart - prevEnd
      if (gap > MAX_PREFERRED_GAP) {
        gaps += gap * 1.5 // Penalize gaps larger than preferred
      } else {
        gaps += gap
      }
    }
  }

  return workingTime / (workingTime + gaps)
}

// Enhanced fit score calculation
function calculateEnhancedFitScore(service, shift, proposedStart, meanStartTime, distanceMatrix) {
  if (!service || !shift || !proposedStart || !meanStartTime) return -Infinity
  
  // Ensure dates are valid
  const proposedStartTime = proposedStart instanceof Date ? proposedStart : new Date(proposedStart)
  const meanTime = meanStartTime instanceof Date ? meanStartTime : new Date(meanStartTime)
  
  if (!proposedStartTime || !meanTime || isNaN(proposedStartTime.getTime()) || isNaN(meanTime.getTime())) {
    return -Infinity
  }

  // Calculate time deviation score (40%)
  const timeDeviation = Math.abs(proposedStartTime.getTime() - meanTime.getTime()) / (60 * 60 * 1000)
  const timeScore = Math.max(0, 1 - timeDeviation / 4) // Max deviation of 4 hours

  // Calculate distance score (30%)
  let distanceScore = 1
  if (shift.services?.length) {
    const lastService = shift.services[shift.services.length - 1]
    if (lastService) {
      const distance = getDistance(lastService, service, distanceMatrix)
      distanceScore = Math.max(0, 1 - distance / MAX_PREFERRED_RADIUS_MILES)
    }
  }

  // Calculate density score (30%)
  const shiftServices = shift.services || []
  const totalDuration = shiftServices.reduce((sum, s) => sum + s.duration, 0) + service.duration
  const shiftSpan = shiftServices.length ? 
    (new Date(shiftServices[shiftServices.length - 1].end).getTime() - new Date(shiftServices[0].start).getTime()) / (60 * 60 * 1000) :
    service.duration / 60
  const density = totalDuration / (shiftSpan * 60)
  const densityScore = Math.max(0, 1 - Math.abs(density - SHIFT_DENSITY_TARGET))

  return timeScore * 0.4 + distanceScore * 0.3 + densityScore * 0.3
}

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

function createNewShift(service, shifts, distanceMatrix) {
  // Find tech with lowest workload
  let minWorkload = Infinity
  let selectedTechId = null

  for (let i = 1; i <= 60; i++) { // Assuming max 60 techs
    const techId = `Tech ${i}`
    const workload = getTechWorkload(techId)
    
    // Skip techs at or above max services
    if (workload.serviceCount >= MAX_SERVICES_PER_TECH) continue
    
    // Calculate weighted workload score
    const workloadScore = (workload.serviceCount * 100) + (workload.totalDuration / 60)
    
    if (workloadScore < minWorkload) {
      minWorkload = workloadScore
      selectedTechId = techId
    }
  }

  if (!selectedTechId) {
    console.warn('No available techs found for new shift')
    return null
  }

  const shiftId = shifts.length
  const shift = {
    id: shiftId,
    techId: selectedTechId,
    services: [],
    startTime: new Date(service.time.range[0]).getTime(),
  }

  updateTechWorkload(selectedTechId, service, shiftId)
  return shift
}

function assignTechsToShifts(shifts, dateStr) {
  // Group shifts by date
  const shiftsByDate = new Map()
  const techAssignmentsByDate = new Map()

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

  // Process each date
  for (const date of sortedDates) {
    const dateShifts = shiftsByDate.get(date)
    
    // Group shifts by rough time windows
    const timeWindows = {
      morning: [],   // 5am-11am
      afternoon: [], // 11am-5pm
      evening: []    // 5pm-5am
    }

    for (const shift of dateShifts) {
      if (!shift?.services?.length) continue
      const startHour = new Date(shift.services[0].start).getHours()
      if (startHour >= 5 && startHour < 11) {
        timeWindows.morning.push(shift)
      } else if (startHour >= 11 && startHour < 17) {
        timeWindows.afternoon.push(shift)
      } else {
        timeWindows.evening.push(shift)
      }
    }

    // Calculate tech assignments based on shift characteristics
    const techAssignments = new Map()
    const maxTechs = 70

    // Helper function to find best tech for a shift
    const findBestTech = (shift, usedTechs) => {
      let bestTech = null
      let bestScore = -Infinity

      // Calculate shift characteristics
      const shiftStart = new Date(shift.services[0].start)
      const shiftLocation = shift.services[0].location
      
      for (let i = 1; i <= maxTechs; i++) {
        const techId = `Tech ${i}`
        
        // Skip if tech already has conflicting shift
        if (usedTechs.has(techId)) {
          const techShifts = shifts.filter(s => s.techId === techId)
          const hasConflict = techShifts.some(s => {
            if (!s.services.length) return false
            const existingStart = new Date(s.services[0].start)
            const existingEnd = new Date(s.services[s.services.length - 1].end)
            const newStart = new Date(shift.services[0].start)
            const newEnd = new Date(shift.services[shift.services.length - 1].end)
            
            // Check for overlap
            return checkTimeOverlap(existingStart, existingEnd, newStart, newEnd)
          })
          if (hasConflict) continue
        }

        // Calculate score based on:
        // 1. Previous assignments in similar time windows
        // 2. Previous assignments in similar locations
        // 3. Current workload balance
        let score = 0
        
        // Time window consistency
        const techStartTime = techStartTimes.get(techId)
        if (techStartTime) {
          const timeDiff = Math.abs(shiftStart.getTime() % (24 * 60 * 60 * 1000) - techStartTime)
          score -= timeDiff / (60 * 60 * 1000) // Prefer similar start times
        }

        // Location consistency
        const techShifts = shifts.filter(s => s.techId === techId)
        if (techShifts.length > 0) {
          const avgLat = techShifts.reduce((sum, s) => sum + s.services[0].location.latitude, 0) / techShifts.length
          const avgLng = techShifts.reduce((sum, s) => sum + s.services[0].location.longitude, 0) / techShifts.length
          const locationScore = -Math.sqrt(
            Math.pow(shiftLocation.latitude - avgLat, 2) + 
            Math.pow(shiftLocation.longitude - avgLng, 2)
          )
          score += locationScore * 10
        }

        // Workload balance
        const techWorkload = techShifts.reduce((sum, s) => sum + s.services.length, 0)
        score -= techWorkload * 0.1 // Slight preference for less loaded techs

        if (score > bestScore) {
          bestScore = score
          bestTech = techId
        }
      }

      return bestTech
    }

    // Assign techs to shifts in each time window
    for (const window of Object.values(timeWindows)) {
      const usedTechs = new Set()
      
      for (const shift of window) {
        const bestTech = findBestTech(shift, usedTechs)
        if (bestTech) {
          shift.techId = bestTech
          shift.cluster = parseInt(bestTech.replace('Tech ', ''))
          usedTechs.add(bestTech)
          
          // Update tech start time
          const startTime = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)
          techStartTimes.set(bestTech, startTime)
        }
      }
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
    placementOrdersByTechDay.clear() // Clear placement orders at start of processing

    console.log('Worker received services:', services.length)
    
    // Track scheduled services by ID AND start time to catch duplicates with different times
    const scheduledServiceTracker = new Map() // Map<serviceId, Set<startTime>>
    
    // Helper function to schedule a service
    const scheduleService = (service, shift, matchInfo) => {
      // Ensure consistent tech ID format
      const techId = typeof shift.techId === 'number' ? 
        `Tech ${shift.techId}` : 
        `Tech ${shift.cluster}`
      
      const order = getNextPlacementOrder(techId, matchInfo.start)
      
      const scheduledService = createScheduledService(service, shift, matchInfo, distanceMatrix)
      scheduledService.placementOrder = order
      shift.services.push(scheduledService)
      
      // Track the scheduled service
      if (!scheduledServiceTracker.has(service.id)) {
        scheduledServiceTracker.set(service.id, new Set())
      }
      scheduledServiceTracker.get(service.id).add(new Date(matchInfo.start).getTime())
      
      return scheduledService
    }

    // Pre-track any services that already have start/end times
    services.forEach(service => {
      if (service.start && service.end) {
        if (!scheduledServiceTracker.has(service.id)) {
          scheduledServiceTracker.set(service.id, new Set())
        }
        scheduledServiceTracker.get(service.id).add(new Date(service.start).getTime())
        
        // Also track placement order
        const order = getNextPlacementOrder(service.tech.code, service.start)
        service.placementOrder = order
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
        
        // Then sort by mean start time
        const aTime = a.meanStartTime.getTime()
        const bTime = b.meanStartTime.getTime()
        if (Math.abs(aTime - bTime) > MAX_ALLOWED_GAP) {
          return aTime - bTime // Keep time-separated services apart
        }
        
        return a.timeWindow - b.timeWindow // Finally sort by time window flexibility
      })

      // Separate long services
      const longServices = sortedServices.filter(s => s.isLongService)
      const regularServices = sortedServices.filter(s => !s.isLongService)

      const shifts = []
      const placementOrderByTech = new Map()

      // Helper function to check and track scheduled services
      const isServiceScheduled = (service, scheduledServices) => {
        if (!service?.start || !scheduledServices?.length) return false
        
        const serviceTime = new Date(service.start).getTime()
        
        for (const scheduled of scheduledServices) {
          if (!scheduled?.start) continue
          const scheduledTime = new Date(scheduled.start).getTime()
          if (serviceTime === scheduledTime) return true
        }
        
        return false
      }

      // First, schedule long services in their own shifts
      for (const service of longServices) {
        if (isServiceScheduled(service, service.meanStartTime)) continue
        
        const newShift = createNewShift(service, shifts, distanceMatrix)
        const scheduledService = createScheduledService(service, newShift, {
          start: service.meanStartTime,
          end: new Date(service.meanStartTime.getTime() + service.duration * 60000)
        }, distanceMatrix)
        
        newShift.services = [scheduledService]
        shifts.push(newShift)
        scheduledServiceTracker.get(service.id).add(service.meanStartTime.getTime())
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
          if (matchInfo && !isServiceScheduled(service, shift.services)) {
            const score = calculateEnhancedFitScore(service, shift, matchInfo.start, service.meanStartTime, distanceMatrix)
            if (score > bestScore) {
              bestScore = score
              bestMatch = matchInfo
              bestShift = shift
            }
          }
        }

        // If no suitable shift found or if service is far in time from existing shifts,
        // create a new shift
        if (!bestMatch || bestScore < -500) { // Added threshold check
          const remainingServices = regularServices.filter(s => !scheduledServiceTracker.has(s.id))
          const newShift = createNewShift(service, shifts, distanceMatrix)
          bestShift = newShift
          bestMatch = {
            start: service.meanStartTime,
            end: new Date(service.meanStartTime.getTime() + service.duration * 60000),
            score: 0
          }
          shifts.push(newShift)
        }

        // Schedule the service
        if (!isServiceScheduled(service, bestShift.services)) {
          const scheduledService = scheduleService(service, bestShift, bestMatch)
          console.log('Scheduled service with order:', scheduledService.placementOrder)
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
          // Add null checks for shifts and their services
          if (!a?.services?.length) return 1
          if (!b?.services?.length) return -1
          
          const aStart = new Date(a.services[0].start).getTime()
          const bStart = new Date(b.services[0].start).getTime()
          return aStart - bStart
        })

        for (let i = 0; i < shiftsByTime.length - 1; i++) {
          const shift1 = shiftsByTime[i]
          if (!shift1?.services?.length) continue
          if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

          const lastService = shift1.services[shift1.services.length - 1]
          if (!lastService) continue

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

  // Calculate utilizations
  const shift1Duration = shift1.services.reduce((total, s) => total + s.duration, 0)
  const shift2Duration = shift2.services.reduce((total, s) => total + s.duration, 0)
  const combinedUtilization = (shift1Duration + shift2Duration) / SHIFT_DURATION_MS

  // Only allow merging if combined utilization is within target
  if (combinedUtilization > SHIFT_DENSITY_TARGET) {
    return false
  }

  // Check for time conflicts with strict overlap prevention
  const sortedServices = [...shift1.services, ...shift2.services].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  )

  for (let i = 0; i < sortedServices.length - 1; i++) {
    const current = sortedServices[i]
    const next = sortedServices[i + 1]
    const currentEnd = new Date(current.end).getTime()
    const nextStart = new Date(next.start).getTime()
    const distance = getDistance(current, next, distanceMatrix)
    
    if (!distance || distance > HARD_MAX_RADIUS_MILES) {
      return false
    }

    const travelTime = calculateTravelTime(distance)
    if (nextStart < currentEnd + travelTime * 60000) {
      return false
    }

    // Check for overlaps
    if (checkTimeOverlap(
      new Date(current.start),
      new Date(current.end),
      new Date(next.start),
      new Date(next.end)
    )) {
      return false
    }
  }

  // Check shift span
  const firstStart = new Date(sortedServices[0].start).getTime()
  const lastEnd = new Date(sortedServices[sortedServices.length - 1].end).getTime()
  
  if (lastEnd - firstStart > MAX_SHIFT_SPAN) {
    return false
  }

  return true
}

function tryMergeShifts(shifts, distanceMatrix) {
  let merged = false
  
  do {
    merged = false
    for (let i = 0; i < shifts.length - 1; i++) {
      const shift1 = shifts[i]
      if (!shift1 || !shift1.services || !shift1.services.length) continue
      if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

      // Create a Set of service IDs in shift1
      const shift1ServiceIds = new Set(shift1.services.map(s => s.id))

      const lastService = shift1.services[shift1.services.length - 1]
      if (!lastService) continue

      const lastEnd = new Date(lastService.end)

      for (let j = i + 1; j < shifts.length; j++) {
        const shift2 = shifts[j]
        if (!shift2 || !shift2.services || !shift2.services.length) continue
        if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

        // Check for duplicate services before attempting merge
        if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
          continue // Skip this merge if any service IDs overlap
        }

        const firstService = shift2.services[0]
        if (!firstService) continue

        const distance = getDistance(lastService, firstService, distanceMatrix)

        if (!distance || distance > HARD_MAX_RADIUS_MILES) continue
        
        const travelTime = calculateTravelTime(distance)
        const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

        if (earliestStart > new Date(firstService.time.range[1])) continue

        const totalServices = shift1.services.length + shift2.services.length
        if (totalServices > 14) continue

        const combinedServices = [...shift1.services]
        
        // Update placement orders for shift2 services
        const techId = `Tech ${shift1.cluster}`
        
        // Add shift2 services with new placement orders
        for (const service of shift2.services) {
          if (!service) continue
          const serviceDate = service.start || service.time.range[0]
          const order = getNextPlacementOrder(techId, serviceDate)
          combinedServices.push({
            ...service,
            placementOrder: order,
            cluster: shift1.cluster
          })
        }
        
        const workingDuration = calculateWorkingDuration(combinedServices)
        if (workingDuration > SHIFT_DURATION) continue

        // If we get here, merge is possible
        shift1.services = combinedServices
        shift1.mergeAttempts++
        shift2.mergeAttempts++
        shifts.splice(j, 1)
        merged = true
        break
      }
      if (merged) break
    }
  } while (merged)

  return merged
}

function findMergeCandidates(shift1, shifts, currentIndex, distanceMatrix) {
  // Create a snapshot of all service IDs in shift1 for atomic checking
  const shift1ServiceIds = new Set(shift1.services.map(s => s.id))
  
  // Add null check for shift1 services
  if (!shift1.services || !shift1.services.length) {
    console.log('No services in shift1 to merge')
    return []
  }

  const lastService = shift1.services[shift1.services.length - 1]
  if (!lastService) {
    console.log('Last service is undefined')
    return []
  }

  return shifts
    .slice(currentIndex + 1)
    .filter(shift2 => {
      if (!shift2 || !shift2.services || !shift2.services.length) return false
      if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
      
      // Check for duplicate services atomically
      if (shift2.services.some(s => shift1ServiceIds.has(s.id))) {
        console.log('Prevented merge candidate with duplicate services:', 
          shift2.services.find(s => shift1ServiceIds.has(s.id)).id)
        return false
      }

      const firstService = shift2.services[0]
      if (!firstService) return false

      const distance = getDistance(lastService, firstService, distanceMatrix)
      
      if (!distance || distance > HARD_MAX_RADIUS_MILES) return false
      
      const travelTime = calculateTravelTime(distance)
      const lastEnd = new Date(lastService.end)
      const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)
      
      // Check if merge would create overlapping services
      const wouldOverlap = shift2.services.some(s2 => 
        shift1.services.some(s1 => 
          s1 && s2 && checkTimeOverlap(
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
      if (!a.services[0] || !b.services[0]) return 0
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
  // Score based on how close we got to the mean start time (30% weight)
  const meanTimeDeviation = Math.abs(tryStart.getTime() - meanStartTime.getTime())
  const timeScore = 1 - (meanTimeDeviation / (4 * 60 * 60 * 1000))
  
  // Get previous and next services for distance scoring (20% weight)
  const prevService = shift.services
    .filter(s => new Date(s.end).getTime() <= tryStart.getTime())
    .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0]
    
  const nextService = shift.services
    .filter(s => new Date(s.start).getTime() >= new Date(tryStart.getTime() + service.duration * 60000).getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]

  // Calculate distance scores with relaxed constraints
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

  // Calculate shift density score (50% weight) - prioritize fuller shifts
  const shiftDuration = calculateShiftSpan([...shift.services, { start: tryStart, end: new Date(tryStart.getTime() + service.duration * 60000) }])
  const targetDuration = SHIFT_DURATION_MS * SHIFT_DENSITY_TARGET
  const densityScore = 1 - Math.abs(shiftDuration - targetDuration) / targetDuration

  // Combine scores with new weights: 30% mean time, 20% distance, 50% density
  return timeScore * 0.3 + distanceScore * 0.2 + densityScore * 0.5
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
  const serviceStart = new Date(service.start || service.time.range[0])
  const serviceEnd = new Date(service.end || new Date(serviceStart.getTime() + service.duration * 60000))
  
  // Check if adding this service would exceed max shift span
  const mockServices = [...shift.services, { start: serviceStart, end: serviceEnd }]
  const shiftSpan = calculateShiftSpan(mockServices)
  if (shiftSpan > MAX_SHIFT_SPAN) {
    console.log(`Service would exceed max shift span: ${service.id}, Span: ${Math.round(shiftSpan / (60 * 60 * 1000))} hours`)
    return false
  }
  
  // Check if this would create a gap larger than allowed
  const maxGap = findLargestGap(mockServices)
  if (maxGap > MAX_ALLOWED_GAP) {
    console.log(`Service would create too large gap: ${service.id}, Gap: ${Math.round(maxGap / (60 * 1000))} minutes`)
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

function isWithinTimeWindow(tryStart, tryEnd, timeWindow) {
  // Convert all times to NY timezone using dayjs
  const timeZone = 'America/New_York'
  const localTryStart = dayjs(tryStart).tz(timeZone)
  const localTryEnd = dayjs(tryEnd).tz(timeZone)
  const localWindowStart = dayjs(timeWindow[0]).tz(timeZone)
  const localWindowEnd = dayjs(timeWindow[1]).tz(timeZone)

  // Get time-only values for comparison (in minutes since midnight)
  const tryStartMinutes = localTryStart.hour() * 60 + localTryStart.minute()
  const tryEndMinutes = localTryEnd.hour() * 60 + localTryEnd.minute()
  const windowStartMinutes = localWindowStart.hour() * 60 + localWindowStart.minute()
  const windowEndMinutes = localWindowEnd.hour() * 60 + localWindowEnd.minute()

  // Handle cases where window crosses midnight
  if (windowEndMinutes < windowStartMinutes) {
    // Window crosses midnight (e.g., 11:00 PM - 2:00 AM)
    return (tryStartMinutes >= windowStartMinutes || tryStartMinutes <= windowEndMinutes) &&
           (tryEndMinutes >= windowStartMinutes || tryEndMinutes <= windowEndMinutes)
  } else {
    // Normal window within same day
    return tryStartMinutes >= windowStartMinutes && tryEndMinutes <= windowEndMinutes
  }
}

function tryFitServiceInShift(service, shift, proposedStart) {
  // Ensure proposedStart is a Date object
  if (!proposedStart || !(proposedStart instanceof Date)) {
    proposedStart = new Date(proposedStart)
  }
  
  if (isNaN(proposedStart.getTime())) {
    return false
  }

  // Check time window constraints
  const timeWindow = service.time.range
  if (!timeWindow || !timeWindow[0] || !timeWindow[1]) return false
  
  const windowStart = new Date(timeWindow[0])
  const windowEnd = new Date(timeWindow[1])
  
  if (proposedStart < windowStart || proposedStart > windowEnd) {
    return false
  }
  
  // Check for overlaps with existing services
  for (const existingService of shift.services) {
    const existingStart = new Date(existingService.start)
    const existingEnd = new Date(existingService.end)
    
    if (proposedStart < existingEnd && new Date(proposedStart.getTime() + service.duration * 60000) > existingStart) {
      return false
    }
  }
  
  // Check shift span
  if (shift.services.length > 0) {
    const firstService = shift.services[0]
    const lastService = shift.services[shift.services.length - 1]
    const shiftStart = new Date(firstService.start)
    const shiftEnd = new Date(lastService.end)
    const proposedEnd = new Date(proposedStart.getTime() + service.duration * 60000)
    
    const span = Math.max(
      proposedEnd - shiftStart,
      shiftEnd - proposedStart,
      shiftEnd - shiftStart
    ) / (1000 * 60 * 60)
    
    if (span > 8) return false
  }
  
  return true
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

function tryMoveService(service, sourceShift, targetShift, distanceMatrix) {
  // Don't move if service already exists in target shift
  if (targetShift.services.some(s => s.id === service.id)) return false

  // Calculate proposed start time based on last service in target shift
  let proposedStart
  if (targetShift.services.length === 0) {
    proposedStart = new Date(service.start)
  } else {
    const lastService = targetShift.services[targetShift.services.length - 1]
    const travelTime = calculateTravelTime(lastService, service) || 15
    proposedStart = new Date(lastService.end)
    proposedStart.setMinutes(proposedStart.getMinutes() + travelTime)
  }
  
  // Check if service fits in target shift
  if (!canFitServiceInShift(service, targetShift, proposedStart)) {
    return false
  }
  
  // Move the service
  const serviceIndex = sourceShift.services.indexOf(service)
  if (serviceIndex > -1) {
    sourceShift.services.splice(serviceIndex, 1)
    service.start = proposedStart.toISOString()
    service.end = new Date(proposedStart.getTime() + service.duration * 60000).toISOString()
    service.techId = targetShift.techId
    targetShift.services.push(service)
    return true
  }
  
  return false
}

// Increase max iterations to allow more optimization attempts
const MAX_ITERATIONS = 600 // Increased from 500 to 600

// Adjust threshold for identifying very overloaded shifts
function isShiftOverloaded(shift) {
  const totalDuration = shift.services.reduce((sum, service) => sum + service.duration, 0)
  const shiftSpan = new Date(shift.services[shift.services.length - 1].end).getTime() - new Date(shift.services[0].start).getTime()
  return totalDuration / (shiftSpan / (60 * 1000)) > 0.85 // Lower threshold from 0.9 to 0.85
}

function findServiceClusters(shifts, distanceMatrix) {
  const clusters = []
  
  // Look through well-utilized shifts for potential clusters
  for (const shift of shifts) {
    if (!shift.services?.length || shift.services.length < 4) continue
    
    const services = [...shift.services].sort((a, b) => 
      new Date(a.start).getTime() - new Date(b.start).getTime()
    )
    
    // Look for sequences of 2-3 services that are close in time and space
    for (let i = 0; i < services.length - 1; i++) {
      const cluster = [services[i]]
      let lastService = services[i]
      
      // Try to add up to 2 more services to the cluster
      for (let j = i + 1; j < Math.min(i + 3, services.length); j++) {
        const nextService = services[j]
        const distance = getDistance(lastService, nextService, distanceMatrix)
        const timeBetween = (new Date(nextService.start).getTime() - new Date(lastService.end).getTime()) / (60 * 1000)
        
        // Check if this service can be added to cluster
        if (distance <= 5 && timeBetween <= 30) {
          cluster.push(nextService)
          lastService = nextService
        } else {
          break
        }
      }
      
      if (cluster.length > 1) {
        // Calculate cluster score
        const totalDuration = cluster.reduce((sum, s) => sum + s.duration, 0)
        const timeSpan = (new Date(cluster[cluster.length-1].end).getTime() - new Date(cluster[0].start).getTime()) / (60 * 1000)
        const density = totalDuration / timeSpan
        
        clusters.push({
          services: cluster,
          score: density * Math.sqrt(totalDuration),
          techId: shift.services[0].techId
        })
      }
    }
  }
  
  return clusters.sort((a, b) => b.score - a.score)
}

function canFitCluster(cluster, targetShift, distanceMatrix) {
  if (!targetShift.services?.length) return true
  
  // Check if adding cluster would exceed 8 hours
  const targetStart = new Date(targetShift.services[0].start).getTime()
  const targetEnd = new Date(targetShift.services[targetShift.services.length-1].end).getTime()
  const clusterStart = new Date(cluster.services[0].start).getTime()
  const clusterEnd = new Date(cluster.services[cluster.services.length-1].end).getTime()
  
  const newSpan = Math.max(
    (targetEnd - targetStart),
    (clusterEnd - targetStart),
    (targetEnd - clusterStart)
  ) / (1000 * 60 * 60)
  
  if (newSpan > 8) return false
  
  // Check for overlaps with existing services
  for (const service of cluster.services) {
    if (!tryFitServiceInShift(service, targetShift, distanceMatrix)) {
      return false
    }
  }
  
  return true
}

function optimizeShifts(shifts) {
  // First pass: handle overloaded shifts (more than 7 services)
  const overloadedShifts = shifts.filter(shift => shift.services.length > 7)
  
  // Sort services in overloaded shifts by duration (longest first)
  for (const shift of overloadedShifts) {
    shift.services.sort((a, b) => b.duration - a.duration)
  }

  // Try to move services from overloaded shifts to target shifts
  for (const shift of overloadedShifts) {
    while (shift.services.length > 7) {
      const service = shift.services[shift.services.length - 1]
      
      // Find target shifts that can take more services (less than 7)
      const targetShifts = shifts.filter(s => 
        s !== shift && 
        s.services.length < 7 &&
        s.techId !== shift.techId
      )

      // Sort target shifts by utilization (ascending)
      targetShifts.sort((a, b) => {
        const aUtil = calculateShiftUtilization(a)
        const bUtil = calculateShiftUtilization(b)
        return aUtil - bUtil
      })

      let moved = false
      for (const targetShift of targetShifts) {
        if (tryMoveService(service, shift, targetShift)) {
          moved = true
          break
        }
      }

      if (!moved) break
    }
  }

  // Second pass: handle very underutilized shifts (1-2 services)
  const underutilizedShifts = shifts.filter(shift => 
    shift.services.length <= 2 && shift.services.length > 0
  )

  for (const shift of underutilizedShifts) {
    // Try to move all services from this shift to other shifts
    const services = [...shift.services]
    for (const service of services) {
      const targetShifts = shifts.filter(s => 
        s !== shift && 
        s.services.length < 7 &&
        s.techId !== shift.techId
      )

      targetShifts.sort((a, b) => {
        const aUtil = calculateShiftUtilization(a)
        const bUtil = calculateShiftUtilization(b)
        return aUtil - bUtil
      })

      for (const targetShift of targetShifts) {
        if (tryMoveService(service, shift, targetShift)) {
          break
        }
      }
    }
  }

  // Remove empty shifts
  return shifts.filter(shift => shift.services.length > 0)
}

function findLargestGap(services) {
  if (!services || services.length < 2) return 0
  
  // Filter out any null/undefined services
  const validServices = services.filter(s => s && s.start && s.end)
  if (validServices.length < 2) return 0
  
  const sortedServices = [...validServices].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
  
  let maxGap = 0
  for (let i = 0; i < sortedServices.length - 1; i++) {
    const currentEnd = new Date(sortedServices[i].end).getTime()
    const nextStart = new Date(sortedServices[i + 1].start).getTime()
    const gap = nextStart - currentEnd
    maxGap = Math.max(maxGap, gap)
  }
  
  return maxGap
}

function calculateShiftUtilization(shift) {
  if (!shift?.services?.length) return 0
  
  // Filter out any services with invalid dates
  const validServices = shift.services.filter(s => s && s.start && s.end)
  if (!validServices.length) return 0
  
  // Sort services by start time
  const sortedServices = [...validServices].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
  
  const totalDuration = sortedServices.reduce((sum, service) => sum + service.duration, 0)
  const shiftSpan = new Date(sortedServices[sortedServices.length - 1].end).getTime() - 
                    new Date(sortedServices[0].start).getTime()
                    
  return totalDuration / (shiftSpan / (60 * 1000))
}

function calculateShiftSpan(services) {
  if (!services || !services.length) return 0
  
  // Filter out any null/undefined services
  const validServices = services.filter(s => s && s.start && s.end)
  if (!validServices.length) return 0
  
  // Sort services by start time
  const sortedServices = [...validServices].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )
  
  // Get first and last service times
  const firstStart = new Date(sortedServices[0].start).getTime()
  const lastEnd = new Date(sortedServices[sortedServices.length - 1].end).getTime()
  
  // Calculate total span
  const span = lastEnd - firstStart
  
  // Check for large gaps that should split the shift
  for (let i = 0; i < sortedServices.length - 1; i++) {
    const currentEnd = new Date(sortedServices[i].end).getTime()
    const nextStart = new Date(sortedServices[i + 1].start).getTime()
    const gap = nextStart - currentEnd
    
    // If there's a gap larger than 45 minutes, treat this as maximum span
    if (gap > MAX_ALLOWED_GAP) {
      return MAX_SHIFT_SPAN + 1 // Force rejection by returning span larger than maximum
    }
  }
  
  return span
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
