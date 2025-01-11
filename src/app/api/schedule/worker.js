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

  // Sort first day's shifts by start time and assign techs sequentially
  const firstDayShifts = shiftsByDate.get(firstDate)
  firstDayShifts.sort((a, b) => new Date(a.services[0].start) - new Date(b.services[0].start))

  // Assign techs to first day and establish baseline start times
  firstDayShifts.forEach((shift, index) => {
    const techNumber = index + 1
    const techId = `Tech ${techNumber}`
    const startTime = new Date(shift.services[0].start).getTime() % (24 * 60 * 60 * 1000)
    techStartTimes.set(techId, startTime)
    shift.techId = techId
    shift.cluster = techNumber // Ensure cluster matches tech number
    techAssignmentsByDate.get(firstDate).add(techId)
  })

  // Process remaining days
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
    
    let duplicates = new Set()
    let invalidServices = new Set()
    let serviceMap = new Map()
    let scheduledServiceIds = new Set()

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
        return
      }

      // Check for duplicates and already scheduled
      if (serviceMap.has(service.id) || scheduledServiceIds.has(service.id)) {
        duplicates.add(service.id)
        return
      }

      serviceMap.set(service.id, {
        ...service,
        duration: service.time.duration,
        isLongService: service.time.duration >= LONG_SERVICE_THRESHOLD
      })
    })

    // Convert to array and add metadata
    let sortedServices = Array.from(serviceMap.values())
      .map(service => ({
        ...service,
        borough: getBorough(service.location.latitude, service.location.longitude),
        startTimeWindow: new Date(service.time.range[1]).getTime() - new Date(service.time.range[0]).getTime(),
        earliestStart: new Date(service.time.range[0]),
        latestStart: new Date(service.time.range[1]),
      }))

    // Separate long services and regular services
    let longServices = sortedServices.filter(s => s.isLongService)
    let regularServices = sortedServices.filter(s => !s.isLongService)

    // Sort regular services by time window flexibility and start time
    regularServices.sort((a, b) => {
      const flexibilityCompare = a.startTimeWindow - b.startTimeWindow
      if (flexibilityCompare !== 0) return flexibilityCompare
      
      const durationCompare = b.time.duration - a.time.duration
      if (durationCompare !== 0) return durationCompare
      
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
          const earliestStart = new Date(lastEnd.getTime() + travelTime * 60000)

          if (earliestStart > new Date(firstService.time.range[1])) continue

          const totalServices = shift1.services.length + shift2.services.length
          if (totalServices > 14) continue

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
            const dist = distanceMatrix[prev.originalIndex][service.originalIndex]
            const travel = calculateTravelTime(dist)
            return {
              ...service,
              cluster: shift1.cluster,
              sequenceNumber: shift1.services.length + 2 + index,
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

    // Sort services within each shift by start time and update relationships
    for (const shift of shifts) {
      shift.services = updateServiceRelationships(shift.services, distanceMatrix)
    }

    // After initial shift creation and before tech assignment
    shifts = optimizeShifts(shifts, distanceMatrix)

    // Proceed with tech assignment
    let shiftsWithTechs = assignTechsToShifts(shifts)

    // After all services are scheduled in shifts
    let mergeAttempts = 0
    while (mergeAttempts < MAX_MERGE_ATTEMPTS) {
      const merged = tryMergeShifts(shiftsWithTechs, distanceMatrix)
      if (!merged) break
      mergeAttempts++
    }

    // Process services with tech assignments
    let processedServices = shiftsWithTechs.flatMap(shift => {
      // Update relationships within each shift while preserving tech assignments
      const updatedServices = updateServiceRelationships(shift.services, distanceMatrix)
      return updatedServices.map(service => ({
        ...service,
        techId: shift.techId,
        cluster: shift.cluster || -1 // Ensure we have a cluster value
      }))
    })

    // Calculate clustering info
    let clusters = new Set(processedServices.map(s => s.cluster).filter(c => c >= 0))

    return {
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(performance.now() - startTime),
        connectedPointsCount: processedServices.length,
        totalClusters: clusters.size,
        clusterDistribution: Array.from(clusters).map(c => ({
          [c]: processedServices.filter(s => s.cluster === c).length,
        })),
        techAssignments: Object.fromEntries(
          Array.from(new Set(processedServices.map(s => s.techId))).map(techId => [
            techId,
            {
              services: processedServices.filter(s => s.techId === techId).length,
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
  // If either shift has more than 14 services, don't merge
  if (shift1.services.length + shift2.services.length > 14) return false

  const shift1End = new Date(shift1.services[shift1.services.length - 1].end)
  const shift2Start = new Date(shift2.services[0].start)
  const shift1Start = new Date(shift1.services[0].start)
  const shift2End = new Date(shift2.services[shift2.services.length - 1].end)
  
  // Calculate travel time between shifts
  const lastService = shift1.services[shift1.services.length - 1]
  const firstNewService = shift2.services[0]
  const distance = getDistance(lastService, firstNewService, distanceMatrix)
  const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
  
  // Add buffer for travel time
  const earliestPossibleStart = new Date(shift1End.getTime() + (travelTime * 60 * 1000))
  
  // If second shift starts after travel time from first shift, they can potentially merge
  if (shift2Start >= earliestPossibleStart) {
    // Check if total shift duration would be reasonable
    const totalDuration = (shift2End - shift1Start) / (60 * 60 * 1000)
    if (totalDuration <= SHIFT_DURATION / 60) return true
  }

  return false
}

function tryMergeShifts(shifts, distanceMatrix) {
  let merged = false
  
  // Sort shifts by number of services (fewest first)
  shifts.sort((a, b) => a.services.length - b.services.length)
  
  for (let i = 0; i < shifts.length; i++) {
    const shift1 = shifts[i]
    
    // Skip if shift already has many services
    if (shift1.services.length >= 14) continue
    
    // Find gaps in the current shift
    const gaps = findShiftGaps(shift1)
    if (!gaps.length) continue

    // Look for services from other shifts that could fit in these gaps
    for (let j = i + 1; j < shifts.length; j++) {
      const shift2 = shifts[j]
      
      // Try to move services from shift2 into shift1's gaps
      const movedServices = []
      
      for (const service of shift2.services) {
        // Try each gap
        for (const gap of gaps) {
          const fitResult = tryFitServiceInGap(service, gap, shift1, distanceMatrix)
          if (fitResult) {
            movedServices.push({
              service,
              start: fitResult.start,
              end: fitResult.end,
              score: fitResult.score
            })
            break
          }
        }
      }

      // If we found services that could move
      if (movedServices.length > 0) {
        // Sort by score to move the best fitting services first
        movedServices.sort((a, b) => b.score - a.score)
        
        // Move services from shift2 to shift1
        for (const move of movedServices) {
          const serviceIndex = shift2.services.findIndex(s => s.id === move.service.id)
          if (serviceIndex !== -1) {
            // Create scheduled service and add to shift1
            const scheduledService = createScheduledService(
              move.service,
              shift1,
              { start: move.start, end: move.end },
              distanceMatrix
            )
            shift1.services.push(scheduledService)
            
            // Remove from shift2
            shift2.services.splice(serviceIndex, 1)
          }
        }

        // If shift2 is now empty, remove it
        if (shift2.services.length === 0) {
          shifts.splice(j, 1)
        }

        // Sort services in shift1 by start time
        shift1.services.sort((a, b) => new Date(a.start) - new Date(b.start))
        
        // Update relationships
        updateServiceRelationships(shift1.services, distanceMatrix)
        if (shift2.services.length > 0) {
          updateServiceRelationships(shift2.services, distanceMatrix)
        }
        
        merged = true
        break
      }
    }
    
    if (merged) break
  }
  
  return merged
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
      const earliestAfterTravel = new Date(lastEnd.getTime() + travelTime * 60000)

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

function optimizeShifts(shifts, distanceMatrix) {
  const originalTechCount = shifts.length
  let bestResult = [...shifts]
  let bestTechCount = shifts.length

  // Sort shifts by number of services (ascending)
  shifts.sort((a, b) => a.services.length - b.services.length)

  // Try to eliminate shifts with fewest services first
  for (let i = 0; i < shifts.length && shifts[i].services.length < 8; i++) {
    const sourceShift = shifts[i]
    
    // Try to distribute all services from this shift to others
    const success = sourceShift.services.every(service => {
      // Try to fit in other shifts, prioritizing those with more capacity
      const targetShifts = shifts
        .filter(s => s !== sourceShift && s.services.length < 14)
        .sort((a, b) => {
          // Score by available capacity and geographic proximity
          const aScore = calculateTargetShiftScore(a, service, distanceMatrix)
          const bScore = calculateTargetShiftScore(b, service, distanceMatrix)
          return bScore - aScore
        })

      for (const targetShift of targetShifts) {
        const gaps = findShiftGaps(targetShift)
        for (const gap of gaps) {
          const fitResult = tryFitServiceInGap(service, gap, targetShift, distanceMatrix)
          if (fitResult) {
            const scheduledService = createScheduledService(
              service,
              targetShift,
              { start: fitResult.start, end: fitResult.end },
              distanceMatrix
            )
            targetShift.services.push(scheduledService)
            targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))
            updateServiceRelationships(targetShift.services, distanceMatrix)
            return true
          }
        }
      }
      return false
    })

    if (success) {
      // Remove the now-empty shift
      shifts.splice(i, 1)
      i--
    }
  }

  return shifts
}

function calculateTargetShiftScore(shift, service, distanceMatrix) {
  // Prioritize shifts that:
  // 1. Have more room for services (but not completely empty)
  // 2. Are geographically close
  // 3. Have compatible time windows
  
  const capacityScore = (14 - shift.services.length) / 14
  
  // Calculate average distance to shift's services
  let distanceScore = 0
  for (const existingService of shift.services) {
    const distance = getDistance(service, existingService, distanceMatrix)
    if (distance <= HARD_MAX_RADIUS_MILES) {
      distanceScore += 1 - (distance / HARD_MAX_RADIUS_MILES)
    }
  }
  distanceScore /= shift.services.length

  // Time window compatibility
  const timeScore = areTimeWindowsCompatible(service, shift.services[0]) ? 1 : 0

  return capacityScore * 0.4 + distanceScore * 0.4 + timeScore * 0.2
}

function groupServicesByProximity(services, distanceMatrix) {
  const groups = []
  const used = new Set()
  
  for (const service of services) {
    if (used.has(service.id)) continue
    
    const group = [service]
    used.add(service.id)
    
    // Find nearby services with compatible time windows
    for (const other of services) {
      if (used.has(other.id)) continue
      
      const distance = getDistance(service, other, distanceMatrix)
      if (distance <= HARD_MAX_RADIUS_MILES / 2) { // More aggressive radius
        const timeCompatible = areTimeWindowsCompatible(service, other)
        if (timeCompatible) {
          group.push(other)
          used.add(other.id)
        }
      }
    }
    
    groups.push(group)
  }
  
  return groups
}

function calculateShiftCompatibilityScore(shift, serviceGroup, distanceMatrix) {
  let score = 0
  
  // Calculate average distance between shift's services and service group
  for (const shiftService of shift.services) {
    for (const groupService of serviceGroup) {
      const distance = getDistance(shiftService, groupService, distanceMatrix)
      if (distance <= HARD_MAX_RADIUS_MILES) {
        score += 1 - (distance / HARD_MAX_RADIUS_MILES)
      }
    }
  }
  
  // Consider time window compatibility
  const timeWindowScore = calculateTimeWindowCompatibility(shift, serviceGroup)
  
  return score + timeWindowScore * 2 // Weight time compatibility more heavily
}

function tryMoveServiceGroup(group, sourceShift, targetShift, distanceMatrix) {
  // Try to fit all services from the group into the target shift
  const gaps = findShiftGaps(targetShift)
  const assignments = []
  
  for (const service of group) {
    let assigned = false
    for (const gap of gaps) {
      const fitResult = tryFitServiceInGap(service, gap, targetShift, distanceMatrix)
      if (fitResult) {
        assignments.push({
          service,
          start: fitResult.start,
          end: fitResult.end
        })
        assigned = true
        break
      }
    }
    if (!assigned) return false
  }
  
  // If we got here, all services can be moved
  for (const assignment of assignments) {
    // Remove from source shift
    sourceShift.services = sourceShift.services.filter(s => s.id !== assignment.service.id)
    
    // Add to target shift
    const scheduledService = createScheduledService(
      assignment.service,
      targetShift,
      assignment,
      distanceMatrix
    )
    targetShift.services.push(scheduledService)
  }
  
  // Sort and update relationships
  targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))
  updateServiceRelationships(targetShift.services, distanceMatrix)
  
  return true
}

function areTimeWindowsCompatible(service1, service2) {
  const start1 = new Date(service1.time.range[0])
  const end1 = new Date(service1.time.range[1])
  const start2 = new Date(service2.time.range[0])
  const end2 = new Date(service2.time.range[1])
  
  // Check if time windows overlap
  const overlap = !(end1 < start2 || end2 < start1)
  
  if (!overlap) return false
  
  // Check if services can be scheduled sequentially within their time windows
  const duration1 = service1.time.duration * 60 * 1000
  const duration2 = service2.time.duration * 60 * 1000
  
  // Can service2 follow service1?
  const canFollow = new Date(start1.getTime() + duration1) <= end2
  
  // Can service1 follow service2?
  const canPrecede = new Date(start2.getTime() + duration2) <= end1
  
  return canFollow || canPrecede
}

function calculateTimeWindowCompatibility(shift, serviceGroup) {
  // Guard against empty shifts
  if (!shift.services || shift.services.length === 0) return 0
  
  let score = 0
  const shiftStart = new Date(shift.services[0].start)
  const shiftEnd = new Date(shift.services[shift.services.length - 1].end)
  
  for (const service of serviceGroup) {
    const serviceStart = new Date(service.time.range[0])
    const serviceEnd = new Date(service.time.range[1])
    
    // Calculate overlap between shift's time span and service's window
    const overlapStart = Math.max(shiftStart, serviceStart)
    const overlapEnd = Math.min(shiftEnd, serviceEnd)
    
    if (overlapEnd > overlapStart) {
      const overlapDuration = (overlapEnd - overlapStart) / (60 * 60 * 1000) // Convert to hours
      score += overlapDuration / SHIFT_DURATION
    }
  }
  
  return score / serviceGroup.length // Normalize by group size
}

// Handle messages from the main thread
parentPort.on('message', async ({ services, distanceMatrix }) => {
  try {
    const result = await processServices(services, distanceMatrix)

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
