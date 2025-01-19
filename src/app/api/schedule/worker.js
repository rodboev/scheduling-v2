import dayjs from 'dayjs'
import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { calculateTravelTime } from '../../map/utils/travelTime.js'
import { areSameBorough, getBorough } from '../../utils/boroughs.js'
import {
  HARD_MAX_RADIUS_MILES,
  LONG_SERVICE_THRESHOLD,
  MAX_MERGE_ATTEMPTS,
  MAX_TIME_SEARCH,
  MERGE_CLOSEST_SHIFTS,
  MIN_BUFFER_BETWEEN_SERVICES,
  SHIFT_DURATION,
  SHIFT_DURATION_MS,
  TECH_START_TIME_VARIANCE
} from '../../utils/constants.js'
import { findShiftGaps } from '../../utils/gaps.js'

const SCORE_CACHE = new Map() // Cache for service compatibility scores

// Track tech start times across days
const techStartTimes = new Map()

// Constants at the top of the file
const HOURS_PER_SHIFT = 8
const MIN_SERVICES_PER_TECH = 4 // Minimum services before trying to merge
const MAX_SERVICES_PER_TECH = 14 // Safety limit for max services
const MAX_SHIFT_DURATION_MS = HOURS_PER_SHIFT * 60 * 60 * 1000
const TARGET_SERVICES_PER_TECH = 12 // Increased target services per tech

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
  const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION_MS)

  // Use the same index for both cluster and techId
  const techNumber = clusterIndex + 1
  return {
    services: [], // Initialize empty, service will be added after
    startTime: shiftStart,
    endTime: shiftEnd,
    cluster: techNumber,
    techId: `Tech ${techNumber}`,
    mergeAttempts: 0,
  }
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

  // Sort first day's shifts by complexity and start time
  const firstDayShifts = shiftsByDate.get(firstDate)
  firstDayShifts.sort((a, b) => {
    // First sort by complexity
    const aComplexity = calculateShiftComplexity(a)
    const bComplexity = calculateShiftComplexity(b)
    if (bComplexity !== aComplexity) return bComplexity - aComplexity
    
    // Then by start time
    return new Date(a.services[0].start) - new Date(b.services[0].start)
  })

  // First day's shifts get assigned sequentially to establish baseline tech start times
  firstDayShifts.forEach((shift, index) => {
    const techNumber = index + 1
    const techId = `Tech ${techNumber}`
    const startTime = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)
    techStartTimes.set(techId, startTime)
    shift.techId = techId
    shift.cluster = techNumber
    techAssignmentsByDate.get(firstDate).add(techId)
  })

  // For subsequent days, try to maintain consistent start times for techs
  for (let dateIndex = 1; dateIndex < sortedDates.length; dateIndex++) {
    const currentDate = sortedDates[dateIndex]
    const currentShifts = shiftsByDate.get(currentDate)
    
    // Sort shifts by complexity and start time
    currentShifts.sort((a, b) => {
      const aComplexity = calculateShiftComplexity(a)
      const bComplexity = calculateShiftComplexity(b)
      if (bComplexity !== aComplexity) return bComplexity - aComplexity
      return new Date(a.services[0].start) - new Date(b.services[0].start)
    })

    // Track tech workload for current date
    const techWorkload = new Map()

    // For each shift, find the best matching tech
    for (const shift of currentShifts) {
      let bestTech = null
      let bestScore = -Infinity

      // Calculate shift's preferred start time
      const shiftStart = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)

      // Try all existing techs
      for (const [techId, preferredStart] of techStartTimes.entries()) {
        // Skip if tech already has too many services today
        if (techWorkload.get(techId) >= 12) continue

        // Calculate score based on:
        // 1. Start time similarity
        // 2. Current workload
        // 3. Geographic continuity with previous day
        let timeVariance = Math.abs(shiftStart - preferredStart)
        if (timeVariance > 12 * 60 * 60 * 1000) { // Wrap around for 24-hour period
          timeVariance = 24 * 60 * 60 * 1000 - timeVariance
        }
        const timeScore = 1 - (timeVariance / (TECH_START_TIME_VARIANCE * 2))

        const workload = techWorkload.get(techId) || 0
        const workloadScore = 1 - (workload / 12)

        // Find tech's last shift from previous date
        const prevDate = sortedDates[dateIndex - 1]
        const prevShifts = shiftsByDate.get(prevDate)
        const lastShift = prevShifts?.find(s => s.techId === techId)
        
        let continuityScore = 0
        if (lastShift) {
          const lastLocation = lastShift.services[lastShift.services.length - 1].location
          const firstLocation = shift.services[0].location
          const distance = calculateDistance(
            { location: lastLocation },
            { location: firstLocation }
          )
          continuityScore = distance ? 1 - Math.min(distance / HARD_MAX_RADIUS_MILES, 1) : 0
        }

        const totalScore = timeScore * 0.4 + workloadScore * 0.4 + continuityScore * 0.2

        if (totalScore > bestScore) {
          bestScore = totalScore
          bestTech = techId
        }
      }

      // If no suitable tech found or score too low, create new tech
      if (!bestTech || bestScore < 0.3) {
        const techNumber = totalTechs + techStartTimes.size + 1
        bestTech = `Tech ${techNumber}`
        techStartTimes.set(bestTech, shiftStart)
      }

      // Assign tech to shift
      shift.techId = bestTech
      shift.cluster = parseInt(bestTech.replace('Tech ', ''))
      techWorkload.set(bestTech, (techWorkload.get(bestTech) || 0) + shift.services.length)
      techAssignmentsByDate.get(currentDate).add(bestTech)

      // Update all services in shift
      shift.services.forEach(service => {
        service.techId = bestTech
        service.cluster = shift.cluster
      })
    }
  }

  // Return shifts with tech assignments
  return shifts
}

function calculateShiftComplexity(shift) {
  // Calculate geographic spread
  const locations = shift.services.map(s => ({
    lat: s.location.latitude,
    lng: s.location.longitude
  }))
  
  const spread = calculateGeographicSpread(locations)
  
  // Combine with service count
  return (shift.services.length / 12) * 0.6 + (spread / HARD_MAX_RADIUS_MILES) * 0.4
}

function calculateGeographicSpread(locations) {
  if (locations.length <= 1) return 0
  
  // Calculate centroid
  const centroid = locations.reduce(
    (acc, loc) => ({
      lat: acc.lat + loc.lat / locations.length,
      lng: acc.lng + loc.lng / locations.length
    }),
    { lat: 0, lng: 0 }
  )
  
  // Calculate average distance from centroid
  return locations.reduce((sum, loc) => {
    const distance = calculateDistance(
      { location: { latitude: centroid.lat, longitude: centroid.lng } },
      { location: { latitude: loc.lat, longitude: loc.lng } }
    )
    return sum + distance
  }, 0) / locations.length
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

function findBestShiftStart(service, otherServices, distanceMatrix) {
  const windowStart = new Date(service.time.range[0])
  const windowEnd = new Date(service.time.range[1])
  let bestStart = windowStart
  let maxScore = -Infinity
  
  // Try different start times within the window
  for (let tryStart = windowStart; tryStart <= windowEnd; tryStart = new Date(tryStart.getTime() + 30 * 60000)) {
    const shiftEnd = new Date(tryStart.getTime() + SHIFT_DURATION_MS)
    let currentTime = new Date(tryStart.getTime() + service.time.duration * 60000)
    let totalScore = 0
    let serviceCount = 1
    let lastService = service
    let totalDuration = service.time.duration
    
    // Track potential services that could fit
    const potentialServices = []
    
    // See how many other services could fit
    for (const otherService of otherServices) {
      const distance = getDistance(lastService, otherService, distanceMatrix)
      if (!distance || distance > HARD_MAX_RADIUS_MILES) continue
      
      const travelTime = calculateTravelTime(distance)
      const earliestStart = new Date(currentTime.getTime() + travelTime * 60000)
      
      if (earliestStart <= new Date(otherService.time.range[1]) && 
          new Date(earliestStart.getTime() + otherService.time.duration * 60000) <= shiftEnd) {
        
        // Calculate score components
        const distanceScore = 1 - (distance / HARD_MAX_RADIUS_MILES)
        const timeScore = otherService.time.preferred ? 
          1 - Math.abs(earliestStart - new Date(otherService.time.preferred)) / (4 * 60 * 60 * 1000) : 0
        const boroughScore = lastService?.location?.latitude && lastService?.location?.longitude && 
          otherService?.location?.latitude && otherService?.location?.longitude && 
          areSameBorough(
            lastService.location.latitude,
            lastService.location.longitude,
            otherService.location.latitude, 
            otherService.location.longitude
          ) ? 0.5 : 0
        
        const serviceScore = distanceScore * 0.4 + timeScore * 0.4 + boroughScore * 0.2
        
        potentialServices.push({
          service: otherService,
          start: earliestStart,
          score: serviceScore
        })
        
        serviceCount++
        lastService = otherService
        currentTime = new Date(earliestStart.getTime() + otherService.time.duration * 60000)
        totalDuration += otherService.time.duration + travelTime
      }
    }
    
    // Calculate overall score for this start time
    const utilizationScore = totalDuration / SHIFT_DURATION
    const totalShiftScore = (utilizationScore * 0.6 + (serviceCount / 14) * 0.4) * 
      potentialServices.reduce((sum, ps) => sum + ps.score, 0)
    
    if (totalShiftScore > maxScore) {
      maxScore = totalShiftScore
      bestStart = tryStart
    }
  }
  
  return bestStart
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
    
    // Track duplicates and invalid services
    const duplicates = new Set()
    const invalidServices = new Set()
    const serviceMap = new Map()
    const scheduledServiceIds = new Set()

    // Pre-filter and deduplicate services
    services.forEach(service => {
      // Check validity conditions
      const isValid = service &&
        service.time &&
        service.time.range &&
        service.time.range[0] &&
        service.time.range[1] &&
        service.location?.id

      if (!isValid) {
        invalidServices.add(service.id)
        console.log('Worker filtered invalid service:', service.id, {
          hasTime: !!service.time,
          hasRange: !!service.time?.range,
          hasStart: !!service.time?.range?.[0],
          hasEnd: !!service.time?.range?.[1],
          hasLocationId: !!service.location?.id
        })
        return
      }

      // Check for duplicates and already scheduled
      if (serviceMap.has(service.id) || scheduledServiceIds.has(service.id)) {
        duplicates.add(service.id)
        console.log('Worker found duplicate/already scheduled service:', service.id)
        return
      }

      serviceMap.set(service.id, {
        ...service,
        duration: service.time.duration,
        isLongService: service.time.duration >= LONG_SERVICE_THRESHOLD
      })
    })

    // Convert to array and add metadata
    const sortedServices = Array.from(serviceMap.values())
      .map(service => ({
        ...service,
        borough: getBorough(service.location.latitude, service.location.longitude),
        startTimeWindow: new Date(service.time.range[1]).getTime() - new Date(service.time.range[0]).getTime(),
        earliestStart: new Date(service.time.range[0]),
        latestStart: new Date(service.time.range[1]),
      }))

    // Separate long services and regular services
    const longServices = sortedServices.filter(s => s.isLongService)
    const regularServices = sortedServices.filter(s => !s.isLongService)

    // Sort regular services by time window flexibility and start time
    regularServices.sort((a, b) => {
      const flexibilityCompare = a.startTimeWindow - b.startTimeWindow
      if (flexibilityCompare !== 0) return flexibilityCompare
      return a.earliestStart.getTime() - b.earliestStart.getTime()
    })


    let shifts = []

    // First, schedule long services in their own shifts
    for (const service of longServices) {
      if (scheduledServiceIds.has(service.id)) continue

      const newShift = createNewShift(service, shifts.length, [], distanceMatrix)
      const scheduledService = createScheduledService(service, newShift, {
        start: service.earliestStart,
        end: new Date(service.earliestStart.getTime() + service.duration * 60000)
      }, distanceMatrix)

      newShift.services = [scheduledService]
      shifts.push(newShift)
      scheduledServiceIds.add(service.id)
    }

    // Then schedule regular services in order of time window flexibility
    for (const service of regularServices) {
      if (scheduledServiceIds.has(service.id)) continue

      // For zero-width time windows, try existing shifts first
      if (service.startTimeWindow === 0) {
        console.log('Processing exact-time service:', {
          id: service.id,
          company: service.company,
          start: service.earliestStart,
          duration: service.duration
        })

        let bestMatch = null
        let bestShift = null

        // Try to fit in existing shifts first
        for (const shift of shifts.sort((a, b) => a.services.length - b.services.length)) {
          // Skip if shift already has max services or is a long-service shift
          if (shift.services.length >= 14 || shift.services.some(s => s.isLongService)) continue

          // Check if this exact time fits in any gap in this shift
          const gaps = findShiftGaps(shift)
          for (const gap of gaps) {
            // For exact-time services, we need an exact fit at the specified time
            const exactStart = service.earliestStart
            const exactEnd = new Date(exactStart.getTime() + service.duration * 60000)
            
            // Check if this exact time window fits in the gap
            if (exactStart >= gap.start && exactEnd <= gap.end) {
              // Verify no overlaps with existing services and travel times
              const wouldOverlap = shift.services.some(existing => {
                const existingStart = new Date(existing.start).getTime()
                const existingEnd = new Date(existing.end).getTime()
                
                // Check direct time overlap
                if (exactStart.getTime() < existingEnd && existingStart < exactEnd.getTime()) {
                  return true
                }

                // Check if there's enough travel time between services
                const distance = getDistance(service, existing, distanceMatrix)
                const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
                const minBuffer = travelTime * 60 * 1000 // Convert minutes to milliseconds

                if (exactStart.getTime() < existingEnd + minBuffer && existingStart - minBuffer < exactEnd.getTime()) {
                  return true
                }

                return false
              })

              if (!wouldOverlap) {
                bestMatch = {
                  start: exactStart,
                  end: exactEnd,
                  score: 0
                }
                bestShift = shift
                break
              }
            }
          }
          if (bestMatch) break
        }

        // If no existing shift works, create a new one
        if (!bestMatch) {
          const newShift = createNewShift(service, shifts.length, [], distanceMatrix)
          newShift.startTime = service.earliestStart
          bestShift = newShift
          bestMatch = {
            start: service.earliestStart,
            end: new Date(service.earliestStart.getTime() + service.duration * 60000),
            score: 0
          }
          shifts.push(newShift)
        }

        const scheduledService = createScheduledService(service, bestShift, bestMatch, distanceMatrix)
        bestShift.services.push(scheduledService)
        scheduledServiceIds.add(service.id)
        
        // Sort services within shift by start time
        bestShift.services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        continue
      }

      let bestMatch = null
      let bestShift = null
      let bestScore = -Infinity

      // Try to fit in existing shifts first
      for (const shift of shifts.sort((a, b) => a.services.length - b.services.length)) {
        // Skip if shift already has max services or is a long-service shift
        if (shift.services.length >= 14 || shift.services.some(s => s.isLongService)) continue

        const gaps = findShiftGaps(shift)
        
        for (const gap of gaps) {
          const matchInfo = tryFitServiceInGap(service, gap, shift, distanceMatrix)
          if (!matchInfo) continue

          // Verify no overlaps with existing services
          const wouldOverlap = shift.services.some(existing => {
            const newStart = new Date(matchInfo.start).getTime()
            const newEnd = new Date(matchInfo.end).getTime()
            const existingStart = new Date(existing.start).getTime()
            const existingEnd = new Date(existing.end).getTime()
            return (newStart < existingEnd && existingStart < newEnd)
          })

          if (!wouldOverlap && matchInfo.score > bestScore) {
            bestScore = matchInfo.score
            bestMatch = matchInfo
            bestShift = shift
          }
        }
      }

      // If no suitable gap found, create new shift
      if (!bestMatch) {
        const remainingServices = regularServices.filter(s => !scheduledServiceIds.has(s.id))
        const newShift = createNewShift(service, shifts.length, remainingServices, distanceMatrix)
        bestShift = newShift
        bestMatch = {
          start: newShift.startTime,
          end: new Date(newShift.startTime.getTime() + service.duration * 60000),
          score: 0
        }
        shifts.push(newShift)
      }

      // Schedule the service
      const scheduledService = createScheduledService(service, bestShift, bestMatch, distanceMatrix)
      bestShift.services.push(scheduledService)
      scheduledServiceIds.add(service.id)

      // Sort services within shift by start time
      bestShift.services.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
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
          const firstService = shift2.services[0]
          const distance = getDistance(lastService, firstService, distanceMatrix)

          if (!distance || distance > HARD_MAX_RADIUS_MILES) continue

          const travelTime = calculateTravelTime(distance)
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60 * 1000)

          if (earliestStart > new Date(firstService.time.range[1])) continue

          const totalServices = shift1.services.length + shift2.services.length
          if (totalServices > 12) continue

          const mergedDuration =
            (Math.max(
              new Date(shift1.services[shift1.services.length - 1].end).getTime(),
              new Date(shift2.services[shift2.services.length - 1].end).getTime(),
            ) -
              Math.min(
                new Date(shift1.services[0].start).getTime(),
                new Date(shift2.services[0].start).getTime(),
              )) /
            (60 * 1000)

          if (mergedDuration > SHIFT_DURATION) continue

          // If we get here, merge is possible
          const adjustedFirstService = {
            ...firstService,
            cluster: shift1.cluster,
            sequenceNumber: shift1.services.length + 1,
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
              sequenceNumber: shift1.services.length + 2 + index,
              distanceFromPrevious: dist,
              travelTimeFromPrevious: travel,
              previousService: prev.id,
              previousCompany: prev.company
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

    // Sort services within each shift by start time and update relationships
    for (const shift of shifts) {
      shift.services = updateServiceRelationships(shift.services, distanceMatrix)
    }

    // Assign initial techs and clusters before merging
    let shiftsWithTechs = assignTechsToShifts(shifts)
    console.log('Initial shifts after tech assignment:', shiftsWithTechs.length)

    // Store original tech assignments
    const originalTechAssignments = new Map(
      shiftsWithTechs.flatMap(shift => 
        shift.services.map(service => [service.id, {
          techId: shift.techId,
          cluster: shift.cluster
        }])
      )
    )

    // After all services are scheduled in shifts
    console.log('Attempting to merge shifts...')
    let mergeAttempts = 0
    while (mergeAttempts < MAX_MERGE_ATTEMPTS) {
      const merged = tryMergeShifts(shiftsWithTechs, distanceMatrix)
      if (!merged) break
      mergeAttempts++
    }
    console.log(`Completed ${mergeAttempts} merge attempts`)

    // Process services with tech assignments
    const processedServices = shiftsWithTechs.flatMap(shift => {
      // Update relationships within each shift while preserving tech assignments
      const updatedServices = updateServiceRelationships(shift.services, distanceMatrix)
      return updatedServices.map(service => ({
        ...service,
        techId: shift.techId,
        cluster: shift.cluster || -1 // Ensure we have a cluster value
      }))
    })

    // Calculate clustering info
    const clusters = new Set(processedServices.map(s => s.cluster).filter(c => c >= 0))
    console.log('Found clusters:', Array.from(clusters))

    // Condense each shift while preserving tech assignments
    console.log('Condensing shifts...')
    const condensedShifts = shiftsWithTechs.map(shift => {
      const condensed = condenseShift(shift, distanceMatrix)
      return {
        ...condensed,
        services: condensed.services.map(service => ({
          ...service,
          techId: originalTechAssignments.get(service.id)?.techId || shift.techId,
          cluster: originalTechAssignments.get(service.id)?.cluster || shift.cluster
        }))
      }
    })
    console.log('Shifts condensed')

    // Process services after condensing, maintaining tech assignments
    const finalServices = condensedShifts.flatMap(shift => shift.services)

    // Verify tech assignments are preserved
    const techCounts = {}
    finalServices.forEach(service => {
      const techId = service.techId
      techCounts[techId] = (techCounts[techId] || 0) + 1
      // Ensure cluster matches tech number
      service.cluster = parseInt(techId.replace('Tech ', ''))
    })
    console.log('Services per tech after condensing:', techCounts)

    // Group services by tech for final processing
    const servicesByTech = {}
    finalServices.forEach(service => {
      if (!servicesByTech[service.techId]) {
        servicesByTech[service.techId] = []
      }
      servicesByTech[service.techId].push(service)
    })

    // Sort services within each tech's group
    Object.values(servicesByTech).forEach(techServices => {
      techServices.sort((a, b) => new Date(a.start) - new Date(b.start))
      // Update sequence numbers within each tech's group
      techServices.forEach((service, index) => {
        service.sequenceNumber = index + 1
        if (index > 0) {
          const prevService = techServices[index - 1]
          service.previousService = prevService.id
          service.previousCompany = prevService.company
          const distance = getDistance(prevService, service, distanceMatrix)
          service.distanceFromPrevious = distance || 0
          service.travelTimeFromPrevious = calculateTravelTime(distance)
        } else {
          service.previousService = null
          service.previousCompany = null
          service.distanceFromPrevious = 0
          service.travelTimeFromPrevious = 0
        }
      })
    })

    // Flatten back to array
    const finalProcessedServices = Object.values(servicesByTech).flat()

    return {
      scheduledServices: finalProcessedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(performance.now() - startTime),
        connectedPointsCount: finalProcessedServices.length,
        totalClusters: clusters.size,
        clusterDistribution: Array.from(clusters).map(c => ({
          [c]: finalProcessedServices.filter(s => s.cluster === c).length,
        })),
        techAssignments: Object.fromEntries(
          Array.from(new Set(finalProcessedServices.map(s => s.techId))).map(techId => [
            techId,
            {
              services: finalProcessedServices.filter(s => s.techId === techId).length,
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

function findMergeCandidates(shift, shiftsByTime, i, distanceMatrix) {
  const lastService = shift.services[shift.services.length - 1]
  const lastEnd = new Date(lastService.end)

  return shiftsByTime
    .slice(i + 1)
    .filter(s => {
      if (s.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
      
      const service = s.services[0]
      const earliestPossibleTime = new Date(service.time.range[0]) // Use earliest possible time
      const distance = getDistance(lastService, service, distanceMatrix)
      const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
      
      // Check if this service could start after last service ends + travel time
      const earliestAfterTravel = new Date(lastEnd.getTime() + travelTime * 60 * 1000)

      // Service can be merged if:
      // 1. It can start as early as needed to fit after the last service
      // 2. That early start time is within its allowed time window
      return earliestPossibleTime <= earliestAfterTravel && 
             earliestAfterTravel <= new Date(service.time.range[1])
    })
    .sort((a, b) => {
      // Prioritize services that can start earlier in their time window
      const aEarliestStart = new Date(a.services[0].time.range[0])
      const bEarliestStart = new Date(b.services[0].time.range[0])
      return aEarliestStart - bEarliestStart
    })
    .slice(0, MERGE_CLOSEST_SHIFTS)
}

function calculateTimeCompatibilityScore(shift1, shift2) {
  const shift1End = new Date(shift1.services[shift1.services.length - 1].end)
  const shift2Start = new Date(shift2.services[0].start)
  
  // Perfect score if shifts are adjacent
  if (Math.abs(shift2Start - shift1End) <= 30 * 60 * 1000) return 1
  
  // Decreasing score based on time gap
  const gap = Math.abs(shift2Start - shift1End) / (60 * 60 * 1000) // Convert to hours
  return Math.max(0, 1 - gap / 8) // Linear decrease over 8 hours
}

function canMergeShifts(shift1, shift2, distanceMatrix) {
  // Don't merge if combined services would exceed max per tech
  if (shift1.services.length + shift2.services.length > MAX_SERVICES_PER_TECH) return false

  // Calculate travel time between shifts
  const lastService = shift1.services[shift1.services.length - 1]
  const firstNewService = shift2.services[0]
  const distance = getDistance(lastService, firstNewService, distanceMatrix)
  
  // More lenient distance check for shifts with few services
  const maxAllowedDistance = (shift1.services.length < 5 || shift2.services.length < 5) ? 
    7 : HARD_MAX_RADIUS_MILES
  if (distance > maxAllowedDistance) return false
  
  const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
  
  // Add buffer for travel time and minimum required gap
  const requiredGap = Math.max(travelTime * 60 * 1000, MIN_BUFFER_BETWEEN_SERVICES)
  const shift1End = new Date(lastService.end)
  const shift2Start = new Date(firstNewService.start)
  const earliestPossibleStart = new Date(shift1End.getTime() + requiredGap)
  
  // Check if second shift starts after required gap from first shift
  if (shift2Start >= earliestPossibleStart) {
    // Check if total shift duration would be reasonable
    const shift1Start = new Date(shift1.services[0].start)
    const shift2End = new Date(shift2.services[shift2.services.length - 1].end)
    const totalDuration = (shift2End - shift1Start) / (60 * 60 * 1000)
    if (totalDuration > HOURS_PER_SHIFT) return false

    // More aggressive merging for shifts with few services
    if (shift1.services.length < 5 || 
        shift2.services.length < 5 || 
        shift1.services.length + shift2.services.length <= TARGET_SERVICES_PER_TECH) {
      return true
    }

    // Check if services would fit within their time windows after merge
    const mergedServices = [...shift1.services]
    let currentTime = shift1End
    
    for (const service of shift2.services) {
      const serviceStart = new Date(Math.max(
        currentTime.getTime() + requiredGap,
        new Date(service.time.range[0]).getTime()
      ))

      // Check if service can start within its time window
      if (serviceStart > new Date(service.time.range[1])) {
        return false
      }

      const serviceEnd = new Date(serviceStart.getTime() + service.time.duration * 60000)
      currentTime = serviceEnd
    }

    // Verify no overlaps between all services
    const allServices = [...shift1.services, ...shift2.services]
    for (let i = 0; i < allServices.length; i++) {
      for (let j = i + 1; j < allServices.length; j++) {
        const service1 = allServices[i]
        const service2 = allServices[j]
        const serviceDist = getDistance(service1, service2, distanceMatrix)
        
        // More lenient distance check for shifts with few services
        const maxServiceDist = (shift1.services.length < 5 || shift2.services.length < 5) ? 
          7 : HARD_MAX_RADIUS_MILES
        if (serviceDist > maxServiceDist) continue
        
        const serviceTravel = serviceDist <= 0.2 ? 0 : calculateTravelTime(serviceDist)
        const serviceGap = Math.max(serviceTravel * 60 * 1000, MIN_BUFFER_BETWEEN_SERVICES)

        const start1 = new Date(service1.start)
        const end1 = new Date(service1.end)
        const start2 = new Date(service2.start)
        const end2 = new Date(service2.end)

        if (start2 < new Date(end1.getTime() + serviceGap) && 
            start1 < new Date(end2.getTime() + serviceGap)) {
          return false
        }
      }
    }

    return true
  }

  return false
}

function mergeShifts(shift1, shift2, distanceMatrix) {
  // Validate shifts have services
  if (!shift1?.services?.length || !shift2?.services?.length) {
    return null
  }

  const lastService = shift1.services[shift1.services.length - 1]
  const firstService = shift2.services[0]
  
  // Validate services exist and have required properties
  if (!lastService?.end || !firstService?.time?.range?.[1]) {
    return null
  }
  
  // Calculate travel time between shifts
  const distance = getDistance(lastService, firstService, distanceMatrix)
  const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
  
  // Calculate earliest possible start for first service of shift2
  const earliestStart = new Date(lastService.end)
  earliestStart.setTime(earliestStart.getTime() + Math.max(travelTime * 60 * 1000, MIN_BUFFER_BETWEEN_SERVICES))
  
  // Check if service would fit in its time window
  if (earliestStart > new Date(firstService.time.range[1])) {
    return null
  }

  // Get the tech assignment that will be used (prefer shift1's tech)
  const techId = shift1.techId
  const cluster = shift1.cluster
  
  // Process all services with proper timing and relationships
  const processedServices = [...shift1.services]
  let currentTime = new Date(lastService.end)
  
  for (const service of shift2.services) {
    const prevService = processedServices[processedServices.length - 1]
    const dist = getDistance(prevService, service, distanceMatrix)
    const travel = dist <= 0.2 ? 0 : calculateTravelTime(dist)
    const minGap = Math.max(travel * 60 * 1000, MIN_BUFFER_BETWEEN_SERVICES)
    
    // Calculate start time based on previous service plus required gap
    const serviceStart = new Date(Math.max(
      currentTime.getTime() + minGap,
      new Date(service.time.range[0]).getTime()
    ))
    
    // Verify service can start within its time window
    if (serviceStart > new Date(service.time.range[1])) {
      return null
    }
    
    const serviceEnd = new Date(serviceStart.getTime() + service.time.duration * 60000)
    currentTime = serviceEnd
    
    processedServices.push({
      ...service,
      techId: techId,
      cluster: cluster,
      sequenceNumber: processedServices.length + 1,
      start: formatDate(serviceStart),
      end: formatDate(serviceEnd),
      distanceFromPrevious: dist,
      travelTimeFromPrevious: travel,
      previousService: prevService.id,
      previousCompany: prevService.company
    })
  }

  // Verify no overlaps in final schedule
  for (let i = 0; i < processedServices.length - 1; i++) {
    const service = processedServices[i]
    const nextService = processedServices[i + 1]
    const dist = getDistance(service, nextService, distanceMatrix)
    const travel = dist <= 0.2 ? 0 : calculateTravelTime(dist)
    const minGap = Math.max(travel * 60 * 1000, MIN_BUFFER_BETWEEN_SERVICES)
    
    const gap = new Date(nextService.start) - new Date(service.end)
    if (gap < minGap) {
      return null
    }
  }

  // Calculate total shift duration after merge
  const mergedStart = new Date(processedServices[0].start)
  const mergedEnd = new Date(processedServices[processedServices.length - 1].end)
  if ((mergedEnd - mergedStart) > MAX_SHIFT_DURATION_MS) {
    return null
  }

  return {
    ...shift1,
    services: processedServices,
    mergeAttempts: shift1.mergeAttempts + 1
  }
}

function tryMergeShifts(shifts, distanceMatrix) {
  // Validate input
  if (!Array.isArray(shifts) || !shifts.length) {
    return false
  }

  // Filter out shifts with no services
  shifts = shifts.filter(shift => shift?.services?.length > 0)
  if (shifts.length < 2) {
    return false
  }

  // First try to merge very small shifts (less than 5 services)
  const smallShifts = shifts.filter(s => s.services.length < 5)
  if (smallShifts.length > 0) {
    // Sort by number of services to prioritize merging smallest shifts first
    smallShifts.sort((a, b) => a.services.length - b.services.length)
    
    for (let i = 0; i < smallShifts.length; i++) {
      const shift1 = smallShifts[i]
      if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

      // Try to merge with ANY shift that can accommodate it
      const candidates = shifts
        .filter(shift2 => {
          if (shift2 === shift1) return false
          if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
          
          // Check if merge is possible
          return canMergeShifts(shift1, shift2, distanceMatrix)
        })
        .sort((a, b) => {
          // First prefer shifts with the same tech
          if (a.techId === shift1.techId && b.techId !== shift1.techId) return -1
          if (b.techId === shift1.techId && a.techId !== shift1.techId) return 1
          
          // Then prefer shifts that would result in closer to target size
          const aTotal = shift1.services.length + a.services.length
          const bTotal = shift1.services.length + b.services.length
          const aToTarget = Math.abs(TARGET_SERVICES_PER_TECH - aTotal)
          const bToTarget = Math.abs(TARGET_SERVICES_PER_TECH - bTotal)
          if (aToTarget !== bToTarget) return aToTarget - bToTarget
          
          // Finally by average distance between services
          const avgDistA = calculateAverageDistance(shift1, a, distanceMatrix)
          const avgDistB = calculateAverageDistance(shift1, b, distanceMatrix)
          return avgDistA - avgDistB
        })

      const bestCandidate = candidates[0]
      if (bestCandidate) {
        const mergedShift = mergeShifts(shift1, bestCandidate, distanceMatrix)
        if (mergedShift) {
          // Update the original shift in the main shifts array
          const mainIndex = shifts.indexOf(shift1)
          shifts[mainIndex] = mergedShift
          shifts.splice(shifts.indexOf(bestCandidate), 1)
          return true
        }
      }
    }
  }

  // Then try to merge shifts that are below target size
  shifts.sort((a, b) => a.services.length - b.services.length)
  
  for (let i = 0; i < shifts.length; i++) {
    const shift1 = shifts[i]
    
    // Skip if already at or above target size
    if (shift1.services.length >= TARGET_SERVICES_PER_TECH) continue
    
    // Skip if we've tried to merge this shift too many times
    if (shift1.mergeAttempts >= MAX_MERGE_ATTEMPTS) continue

    // Find potential merge candidates
    const candidates = shifts.slice(i + 1)
      .filter(shift2 => {
        if (shift2.mergeAttempts >= MAX_MERGE_ATTEMPTS) return false
        
        // Check if merge is possible
        return canMergeShifts(shift1, shift2, distanceMatrix)
      })
      .sort((a, b) => {
        // First prefer shifts with the same tech
        if (a.techId === shift1.techId && b.techId !== shift1.techId) return -1
        if (b.techId === shift1.techId && a.techId !== shift1.techId) return 1

        // Then by number of services (prefer merging to get closer to target)
        const aTotal = shift1.services.length + a.services.length
        const bTotal = shift1.services.length + b.services.length
        const aToTarget = Math.abs(TARGET_SERVICES_PER_TECH - aTotal)
        const bToTarget = Math.abs(TARGET_SERVICES_PER_TECH - bTotal)
        if (aToTarget !== bToTarget) return aToTarget - bToTarget

        // Finally by average distance between services
        const avgDistA = calculateAverageDistance(shift1, a, distanceMatrix)
        const avgDistB = calculateAverageDistance(shift1, b, distanceMatrix)
        return avgDistA - avgDistB
      })

    // Try to merge with best candidate
    const bestCandidate = candidates[0]
    if (bestCandidate) {
      const mergedShift = mergeShifts(shift1, bestCandidate, distanceMatrix)
      if (mergedShift) {
        // Update shifts array
        const mainIndex = shifts.indexOf(shift1)
        shifts[mainIndex] = mergedShift
        shifts.splice(shifts.indexOf(bestCandidate), 1)
        return true
      }
    }
  }

  return false
}

function calculateAverageDistance(shift1, shift2, distanceMatrix) {
  let totalDistance = 0
  let count = 0

  for (const service1 of shift1.services) {
    for (const service2 of shift2.services) {
      const distance = getDistance(service1, service2, distanceMatrix)
      if (distance !== null) {
        totalDistance += distance
        count++
      }
    }
  }

  return count > 0 ? totalDistance / count : Infinity
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

function tryFitServiceInGap(service, gap, shift, distanceMatrix) {
  const prevService = shift.services
    .filter(s => new Date(s.end).getTime() <= gap.start.getTime())
    .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0]
    
  const nextService = shift.services
    .filter(s => new Date(s.start).getTime() >= gap.end.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]

  // Calculate distances and travel times
  const prevDistance = prevService ? getDistance(prevService, service, distanceMatrix) : 0
  const nextDistance = nextService ? getDistance(service, nextService, distanceMatrix) : 0

  if (prevDistance > HARD_MAX_RADIUS_MILES || nextDistance > HARD_MAX_RADIUS_MILES) return null

  const prevTravelTime = calculateTravelTime(prevDistance)
  const nextTravelTime = calculateTravelTime(nextDistance)

  // Calculate earliest start after previous service plus travel time
  const earliestStart = prevService
    ? new Date(new Date(prevService.end).getTime() + prevTravelTime * 60000)
    : gap.start

  // Calculate latest possible end before next service
  const latestEnd = nextService
    ? new Date(new Date(nextService.start).getTime() - nextTravelTime * 60000)
    : gap.end

  // Get service's allowed time window
  const windowStart = new Date(service.time.range[0])
  const windowEnd = new Date(service.time.range[1])

  // Find best start time that respects both travel time and service window
  const serviceStart = new Date(Math.max(
    earliestStart.getTime(),
    windowStart.getTime()
  ))

  // If we can't start within the service's time window, reject this placement
  if (serviceStart > windowEnd) return null

  const serviceEnd = new Date(serviceStart.getTime() + service.time.duration * 60000)

  // If service would overlap with next service (including travel time), reject
  if (serviceEnd > latestEnd) {
    // Try pushing the service later if possible
    const adjustedStart = new Date(latestEnd.getTime() - service.time.duration * 60000)
    if (adjustedStart >= windowStart && adjustedStart <= windowEnd) {
      return {
        start: adjustedStart,
        end: new Date(adjustedStart.getTime() + service.time.duration * 60000),
        score: calculateServiceScore(
          service,
          prevService || { end: gap.start },
          prevDistance,
          prevTravelTime,
          shift.services,
          [],
          distanceMatrix
        )
      }
    }
    return null
  }

  return {
    start: serviceStart,
    end: serviceEnd,
    score: calculateServiceScore(
      service,
      prevService || { end: gap.start },
      prevDistance,
      prevTravelTime,
      shift.services,
      [],
      distanceMatrix
    )
  }
}

function condenseShift(shift, distanceMatrix) {
  if (!shift?.services?.length) return shift
  
  // Create mutable copies of services
  const mutableServices = shift.services.map(service => ({
    ...service,
    time: {
      ...service.time,
      range: [...service.time.range]
    },
    start: service.start,
    end: service.end,
    startTime: new Date(service.start),
    endTime: new Date(service.end)
  }))

  // Sort services by start time
  mutableServices.sort((a, b) => a.startTime - b.startTime)

  // Find shift midpoint
  const shiftStart = mutableServices[0].startTime
  const shiftEnd = mutableServices[mutableServices.length - 1].endTime
  const midpoint = new Date(shiftStart.getTime() + (shiftEnd.getTime() - shiftStart.getTime()) / 2)

  // Split services into first and second half
  const firstHalf = mutableServices.filter(s => s.startTime <= midpoint)
  const secondHalf = mutableServices.filter(s => s.startTime > midpoint)

  // Helper function to check for overlaps
  function wouldOverlap(service1, service2) {
    const start1 = service1.startTime
    const end1 = service1.endTime
    const start2 = service2.startTime
    const end2 = service2.endTime
    
    const distance = getDistance(service1, service2, distanceMatrix)
    const travelTime = calculateTravelTime(distance)
    const requiredGap = Math.max(
      travelTime * 60 * 1000,
      MIN_BUFFER_BETWEEN_SERVICES
    )

    // Check if service2 starts before service1 ends (plus required gap)
    if (start2 < new Date(end1.getTime() + requiredGap)) return true
    // Check if service1 starts before service2 ends (plus required gap)
    if (start1 < new Date(end2.getTime() + requiredGap)) return true

    return false
  }

  // Helper function to check if a service can be moved to a new time
  function canMoveService(service, newStartTime, otherServices) {
    const newEndTime = new Date(newStartTime.getTime() + service.time.duration * 60000)
    const serviceWithNewTimes = {
      ...service,
      startTime: newStartTime,
      endTime: newEndTime
    }

    // Check time window constraints
    if (newStartTime < new Date(service.time.range[0]) || 
        newStartTime > new Date(service.time.range[1])) {
      return false
    }

    // Check for overlaps with all other services
    return !otherServices.some(other => 
      other !== service && wouldOverlap(serviceWithNewTimes, other)
    )
  }

  // Condense first half (move services later)
  if (firstHalf.length > 1) {
    // Start from the last service and work backwards
    for (let i = firstHalf.length - 1; i > 0; i--) {
      const currentService = firstHalf[i]
      const previousService = firstHalf[i - 1]
      
      // Calculate latest possible start time for current service
      const latestPossibleStart = new Date(Math.min(
        new Date(currentService.time.range[1]).getTime(),
        currentService.startTime.getTime()
      ))
      
      // Calculate required gap
      const distance = getDistance(previousService, currentService, distanceMatrix)
      const travelTime = calculateTravelTime(distance)
      const requiredGap = Math.max(
        travelTime * 60 * 1000,
        MIN_BUFFER_BETWEEN_SERVICES
      )
      
      // Calculate the latest possible time for the previous service
      const latestPreviousEnd = new Date(currentService.startTime.getTime() - requiredGap)
      const previousDuration = previousService.time.duration * 60 * 1000
      const latestPreviousStart = new Date(latestPreviousEnd.getTime() - previousDuration)
      
      // Check if we can move the previous service later
      if (canMoveService(previousService, latestPreviousStart, mutableServices)) {
        previousService.startTime = latestPreviousStart
        previousService.endTime = latestPreviousEnd
        previousService.start = formatDate(latestPreviousStart)
        previousService.end = formatDate(latestPreviousEnd)
      }
    }
  }

  // Condense second half (move services earlier)
  if (secondHalf.length > 1) {
    // Start from the first service and work forwards
    for (let i = 0; i < secondHalf.length - 1; i++) {
      const currentService = secondHalf[i]
      const nextService = secondHalf[i + 1]
      
      // Calculate earliest possible start time for next service
      const earliestPossibleStart = new Date(Math.max(
        new Date(nextService.time.range[0]).getTime(),
        currentService.endTime.getTime()
      ))
      
      // Calculate required gap
      const distance = getDistance(currentService, nextService, distanceMatrix)
      const travelTime = calculateTravelTime(distance)
      const requiredGap = Math.max(
        travelTime * 60 * 1000,
        MIN_BUFFER_BETWEEN_SERVICES
      )
      
      // Calculate the earliest possible start time for the next service
      const earliestNextStart = new Date(currentService.endTime.getTime() + requiredGap)
      
      // Check if we can move the next service earlier
      if (canMoveService(nextService, earliestNextStart, mutableServices)) {
        nextService.startTime = earliestNextStart
        nextService.endTime = new Date(earliestNextStart.getTime() + nextService.time.duration * 60000)
        nextService.start = formatDate(nextService.startTime)
        nextService.end = formatDate(nextService.endTime)
      }
    }
  }

  // Combine and sort all services
  const condensedServices = [...firstHalf, ...secondHalf].sort((a, b) => 
    a.startTime - b.startTime
  )

  // Final overlap check and fix
  for (let i = 1; i < condensedServices.length; i++) {
    const prevService = condensedServices[i - 1]
    const currentService = condensedServices[i]
    
    if (wouldOverlap(prevService, currentService)) {
      // Calculate earliest valid start time for current service
      const distance = getDistance(prevService, currentService, distanceMatrix)
      const travelTime = calculateTravelTime(distance)
      const requiredGap = Math.max(
        travelTime * 60 * 1000,
        MIN_BUFFER_BETWEEN_SERVICES
      )
      
      const newStart = new Date(prevService.endTime.getTime() + requiredGap)
      
      // Only adjust if within allowed time window
      if (canMoveService(currentService, newStart, condensedServices)) {
        currentService.startTime = newStart
        currentService.endTime = new Date(newStart.getTime() + currentService.time.duration * 60000)
        currentService.start = formatDate(currentService.startTime)
        currentService.end = formatDate(currentService.endTime)
      }
    }
  }

  // Verify no overlaps remain
  for (let i = 0; i < condensedServices.length; i++) {
    for (let j = i + 1; j < condensedServices.length; j++) {
      if (wouldOverlap(condensedServices[i], condensedServices[j])) {
        // If overlap found, revert to original times for these services
        const orig1 = shift.services.find(s => s.id === condensedServices[i].id)
        const orig2 = shift.services.find(s => s.id === condensedServices[j].id)
        condensedServices[i] = {
          ...condensedServices[i],
          start: orig1.start,
          end: orig1.end,
          startTime: new Date(orig1.start),
          endTime: new Date(orig1.end)
        }
        condensedServices[j] = {
          ...condensedServices[j],
          start: orig2.start,
          end: orig2.end,
          startTime: new Date(orig2.start),
          endTime: new Date(orig2.end)
        }
      }
    }
  }

  // Update sequence numbers and relationships
  condensedServices.forEach((service, index) => {
    service.sequenceNumber = index + 1
    if (index > 0) {
      const prevService = condensedServices[index - 1]
      service.previousService = prevService.id
      service.previousCompany = prevService.company
      const distance = getDistance(prevService, service, distanceMatrix)
      service.distanceFromPrevious = distance || 0
      service.travelTimeFromPrevious = calculateTravelTime(distance)
    } else {
      service.previousService = null
      service.previousCompany = null
      service.distanceFromPrevious = 0
      service.travelTimeFromPrevious = 0
    }
  })

  // Return updated shift with preserved tech and cluster info
  return {
    ...shift,
    services: condensedServices.map(service => ({
      ...service,
      techId: shift.techId,
      cluster: shift.cluster
    }))
  }
}

function initializeShifts(services) {
  // Calculate target shift count based on total work duration
  const totalWorkMinutes = services.reduce((sum, service) => sum + service.time.duration, 0)
  const totalTravelMinutes = (services.length - 1) * 15 // Rough estimate for travel time
  const totalMinutes = totalWorkMinutes + totalTravelMinutes
  const targetShiftCount = Math.min(
    Math.ceil(totalMinutes / (HOURS_PER_SHIFT * 60)),
    TARGET_TECH_COUNT
  )

  // First, group services by date
  const servicesByDate = new Map()
  services.forEach(service => {
    const date = dayjs(service.time.range[0]).format('YYYY-MM-DD')
    if (!servicesByDate.has(date)) {
      servicesByDate.set(date, [])
    }
    servicesByDate.get(date).push(service)
  })

  // Process each date separately
  const allShifts = []
  let techCounter = 1

  for (const [date, dateServices] of servicesByDate) {
    // Sort services by time window flexibility and start time
    const sortedServices = dateServices.sort((a, b) => {
      // First sort by time window flexibility
      const aWindow = new Date(a.time.range[1]) - new Date(a.time.range[0])
      const bWindow = new Date(b.time.range[1]) - new Date(b.time.range[0])
      if (aWindow !== bWindow) return aWindow - bWindow
      
      // Then by earliest start time
      return new Date(a.time.range[0]) - new Date(b.time.range[0])
    })

    // Group services by time windows that could potentially form shifts
    const timeWindows = []
    let currentWindow = []
    let currentEndTime = null

    for (const service of sortedServices) {
      const serviceStart = new Date(service.time.range[0])
      
      // If this is a new window or service can't fit in current window
      if (!currentWindow.length || 
          !currentEndTime || 
          serviceStart.getTime() - currentEndTime.getTime() > MAX_TIME_SEARCH * 60 * 1000) {
        if (currentWindow.length) {
          timeWindows.push(currentWindow)
        }
        currentWindow = [service]
        currentEndTime = new Date(service.time.range[1])
      } else {
        currentWindow.push(service)
        currentEndTime = new Date(Math.max(
          currentEndTime.getTime(),
          new Date(service.time.range[1]).getTime()
        ))
      }
    }
    if (currentWindow.length) {
      timeWindows.push(currentWindow)
    }

    // Create initial shifts from time windows
    for (const windowServices of timeWindows) {
      // Sort by exact time services first, then by time window flexibility
      const sortedWindowServices = windowServices.sort((a, b) => {
        const aExact = new Date(a.time.range[1]) - new Date(a.time.range[0]) === 0
        const bExact = new Date(b.time.range[1]) - new Date(b.time.range[0]) === 0
        if (aExact !== bExact) return aExact ? -1 : 1

        const aWindow = new Date(a.time.range[1]) - new Date(a.time.range[0])
        const bWindow = new Date(b.time.range[1]) - new Date(b.time.range[0])
        if (aWindow !== bWindow) return aWindow - bWindow

        return new Date(a.time.range[0]) - new Date(b.time.range[0])
      })

      // Create shifts with services that must happen at exact times
      const exactTimeServices = sortedWindowServices.filter(
        s => new Date(s.time.range[1]) - new Date(s.time.range[0]) === 0
      )

      for (const service of exactTimeServices) {
        const techId = `Tech ${techCounter}`
        allShifts.push({
          services: [{
            ...service,
            cluster: techCounter,
            techId: techId,
            sequenceNumber: 1,
            start: formatDate(new Date(service.time.range[0])),
            end: formatDate(new Date(service.time.range[0].getTime() + service.time.duration * 60000)),
            distanceFromPrevious: 0,
            travelTimeFromPrevious: 0,
            previousService: null,
            previousCompany: null
          }],
          mergeAttempts: 0,
          startTime: new Date(service.time.range[0]),
          endTime: new Date(service.time.range[0].getTime() + service.time.duration * 60000),
          techId: techId,
          cluster: techCounter
        })
        techCounter = (techCounter % TARGET_TECH_COUNT) + 1
      }

      // Create shifts for remaining flexible services
      const flexibleServices = sortedWindowServices.filter(
        s => new Date(s.time.range[1]) - new Date(s.time.range[0]) > 0
      )

      let currentShift = []
      let currentShiftDuration = 0
      let currentShiftStart = null

      for (const service of flexibleServices) {
        // If adding this service would exceed shift duration, create new shift
        if (currentShiftDuration + service.time.duration > HOURS_PER_SHIFT * 60) {
          if (currentShift.length > 0) {
            const techId = `Tech ${techCounter}`
            const processedServices = currentShift.map((s, index) => ({
              ...s,
              cluster: techCounter,
              techId: techId,
              sequenceNumber: index + 1,
              start: formatDate(new Date(currentShiftStart.getTime() + index * 60 * 60 * 1000)),
              end: formatDate(new Date(currentShiftStart.getTime() + index * 60 * 60 * 1000 + s.time.duration * 60000)),
              distanceFromPrevious: index === 0 ? 0 : 1,
              travelTimeFromPrevious: index === 0 ? 0 : 15,
              previousService: index === 0 ? null : currentShift[index - 1].id,
              previousCompany: index === 0 ? null : currentShift[index - 1].company
            }))

            allShifts.push({
              services: processedServices,
              mergeAttempts: 0,
              startTime: currentShiftStart,
              endTime: new Date(currentShiftStart.getTime() + SHIFT_DURATION * 60000),
              techId: techId,
              cluster: techCounter
            })
            techCounter = (techCounter % TARGET_TECH_COUNT) + 1
          }
          currentShift = []
          currentShiftDuration = 0
          currentShiftStart = null
        }

        if (!currentShiftStart) {
          currentShiftStart = new Date(service.time.range[0])
        }
        currentShift.push(service)
        currentShiftDuration += service.time.duration
      }

      // Add any remaining services in current shift
      if (currentShift.length > 0) {
        const techId = `Tech ${techCounter}`
        const processedServices = currentShift.map((s, index) => ({
          ...s,
          cluster: techCounter,
          techId: techId,
          sequenceNumber: index + 1,
          start: formatDate(new Date(currentShiftStart.getTime() + index * 60 * 60 * 1000)),
          end: formatDate(new Date(currentShiftStart.getTime() + index * 60 * 60 * 1000 + s.time.duration * 60000)),
          distanceFromPrevious: index === 0 ? 0 : 1,
          travelTimeFromPrevious: index === 0 ? 0 : 15,
          previousService: index === 0 ? null : currentShift[index - 1].id,
          previousCompany: index === 0 ? null : currentShift[index - 1].company
        }))

        allShifts.push({
          services: processedServices,
          mergeAttempts: 0,
          startTime: currentShiftStart,
          endTime: new Date(currentShiftStart.getTime() + SHIFT_DURATION * 60000),
          techId: techId,
          cluster: techCounter
        })
        techCounter = (techCounter % TARGET_TECH_COUNT) + 1
      }
    }
  }

  return allShifts
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