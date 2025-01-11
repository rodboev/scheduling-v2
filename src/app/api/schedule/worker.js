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

  return {
    services: [], // Initialize empty, service will be added after
    startTime: shiftStart,
    endTime: shiftEnd,
    cluster: -1, // Don't assign cluster/tech yet
    mergeAttempts: 0,
  }
}

function assignTechsToShifts(shifts) {
  console.log('\nAssigning techs to shifts:')
  console.log('Initial shifts:', shifts.length)
  console.log('Shift sizes:', shifts.map(s => s.services.length).sort((a,b) => a-b).join(', '))
  
  // First sort shifts by size (largest first) to ensure most efficient tech assignment
  shifts.sort((a, b) => b.services.length - a.services.length)
  
  // Assign unique tech IDs and clusters
  const shiftsWithTechs = shifts.map((shift, index) => {
    const techNumber = index + 1
    return {
      ...shift,
      techId: `Tech ${techNumber}`,
      cluster: techNumber
    }
  })
  
  console.log('After tech assignment:')
  console.log('Total techs:', shiftsWithTechs.length)
  console.log('Services per tech:', shiftsWithTechs.map(s => s.services.length).sort((a,b) => a-b).join(', '))
  
  // Verify tech assignments
  const techIds = new Set(shiftsWithTechs.flatMap(shift => 
    shift.services.map(s => s.techId)
  ))
  console.log('Unique tech IDs:', techIds.size)
  
  return shiftsWithTechs
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

    console.log('Sorted services time windows:', regularServices.slice(0, 10).map(s => ({
      id: s.id,
      company: s.company,
      window: s.startTimeWindow,
      start: s.earliestStart,
      duration: s.duration
    })))

    const shifts = []

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

    // After initial scheduling of services into shifts
    console.log('Initial shifts before merging:', shifts.length)
    
    // Use a single aggressive merging strategy
    let keepTrying = true
    let maxRadius = 15 // Start with smaller radius
    let totalMerged = 0
    
    while (keepTrying) {
      keepTrying = false
      shifts.sort((a, b) => a.services.length - b.services.length)
      
      // Try to merge smallest shifts first - more aggressive with size limit
      for (let i = 0; i < shifts.length && shifts[i].services.length <= 6; i++) {
        const sourceShift = shifts[i]
        
        // Find compatible shifts within radius
        const compatibleShifts = shifts
          .filter(shift => 
            shift !== sourceShift &&
            shift.services.length < 12 &&
            // Check if any service in the shift is close enough
            shift.services.some(s => 
              sourceShift.services.some(ss => {
                const distance = getDistance(ss, s, distanceMatrix)
                return distance !== null && distance <= maxRadius
              })
            )
          )
          .sort((a, b) => {
            // First try shifts with fewer services
            const sizeCompare = a.services.length - b.services.length
            if (Math.abs(sizeCompare) > 2) return sizeCompare
            
            // Then try shifts with services at similar times
            const aTimeScore = Math.min(...a.services.map(s => 
              Math.min(...sourceShift.services.map(ss =>
                Math.abs(new Date(s.start).getTime() - new Date(ss.start).getTime())
              ))
            ))
            const bTimeScore = Math.min(...b.services.map(s =>
              Math.min(...sourceShift.services.map(ss =>
                Math.abs(new Date(s.start).getTime() - new Date(ss.start).getTime())
              ))
            ))
            return aTimeScore - bTimeScore
          })

        // Try each compatible shift until we find one that works
        for (const targetShift of compatibleShifts) {
          let allServicesMoved = true
          const originalServices = [...sourceShift.services]
          
          for (const service of originalServices) {
            if (!tryMoveServiceToShift(service, sourceShift, targetShift, shifts, i, distanceMatrix)) {
              allServicesMoved = false
              break
            }
          }
          
          if (allServicesMoved) {
            keepTrying = true
            totalMerged++
            i-- // Adjust index since we removed a shift
            break
          }
        }
        
        if (keepTrying) break
      }
      
      if (!keepTrying && maxRadius < 40) { // More aggressive max radius
        maxRadius += 5
        keepTrying = true
      }
    }

    // Only assign techs once after all merging is complete
    const shiftsWithTechs = assignTechsToShifts(shifts)
    
    // Process final services - ensure tech IDs are properly set
    const processedServices = shiftsWithTechs.flatMap(shift => {
      const updatedServices = updateServiceRelationships(shift.services, distanceMatrix)
      return updatedServices.map(service => ({
        ...service,
        techId: shift.techId,
        cluster: shift.cluster
      }))
    })

    return {
      scheduledServices: processedServices,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: performance.now() - startTime,
        totalClusters: shiftsWithTechs.length,
        clusterSizes: shiftsWithTechs.map(s => s.services.length),
        clusterDistribution: calculateClusterDistribution(shiftsWithTechs)
      }
    }
  } catch (error) {
    console.error('Error in worker:', error)
    throw error
  }
}

function canMergeShifts(shift1, shift2, distanceMatrix) {
  // If either shift has more than 12 services, don't merge
  if (shift1.services.length + shift2.services.length > 12) return false

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
    if (totalDuration <= HOURS_PER_SHIFT) return true
  }

  return false
}

function getTimeWindowOverlap(service, targetServices) {
  const serviceWindow = {
    start: new Date(service.time.range[0]).getTime(),
    end: new Date(service.time.range[1]).getTime()
  }
  
  return Math.max(...targetServices.map(s => {
    const targetWindow = {
      start: new Date(s.time.range[0]).getTime(),
      end: new Date(s.time.range[1]).getTime()
    }
    return Math.min(serviceWindow.end, targetWindow.end) - 
           Math.max(serviceWindow.start, targetWindow.start)
  }))
}

function getTimeProximityScore(service, targetServices) {
  // Find the closest service in time
  const serviceTime = new Date(service.start).getTime()
  return Math.min(...targetServices.map(s => 
    Math.abs(new Date(s.start).getTime() - serviceTime)
  ))
}

function canFitServiceAt(service, startTime, gap, shift, distanceMatrix) {
  const endTime = new Date(startTime.getTime() + service.duration * 60 * 1000)
  
  // Check if service fits within gap
  if (endTime > gap.end) return false
  
  // Verify travel times
  if (gap.prevService) {
    const distance = getDistance(gap.prevService, service, distanceMatrix)
    const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
    const minStart = new Date(gap.prevService.end).getTime() + travelTime * 60 * 1000
    if (startTime < minStart) return false
  }
  
  if (gap.nextService) {
    const distance = getDistance(service, gap.nextService, distanceMatrix)
    const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
    const maxEnd = new Date(gap.nextService.start).getTime() - travelTime * 60 * 1000
    if (endTime > maxEnd) return false
  }
  
  return true
}

function getShiftCenter(services) {
  const total = services.reduce((acc, service) => ({
    lat: acc.lat + service.location.latitude,
    lng: acc.lng + service.location.longitude
  }), { lat: 0, lng: 0 })
  
  return {
    latitude: total.lat / services.length,
    longitude: total.lng / services.length
  }
}

function getDistanceBetweenCenters(center1, center2) {
  // Use Haversine formula to calculate distance between points
  const R = 3959 // Earth's radius in miles
  const lat1 = center1.latitude * Math.PI / 180
  const lat2 = center2.latitude * Math.PI / 180
  const dLat = (center2.latitude - center1.latitude) * Math.PI / 180
  const dLon = (center2.longitude - center1.longitude) * Math.PI / 180

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
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

function tryFitServiceInGap(service, gap, targetShift, distanceMatrix) {
  const tryStart = new Date(gap.start)
  if (tryStart >= new Date(service.time.range[0]) && 
      tryStart <= new Date(service.time.range[1])) {
    
    const tryEnd = new Date(tryStart.getTime() + service.duration * 60 * 1000)
    
    // Verify travel times
    if (gap.prevService) {
      const distance = getDistance(gap.prevService, service, distanceMatrix)
      const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
      const minStart = new Date(gap.prevService.end).getTime() + travelTime * 60 * 1000
      if (tryStart.getTime() < minStart) return false
    }
    
    if (gap.nextService) {
      const distance = getDistance(service, gap.nextService, distanceMatrix)
      const travelTime = distance <= 0.2 ? 0 : calculateTravelTime(distance)
      const maxEnd = new Date(gap.nextService.start).getTime() - travelTime * 60 * 1000
      if (tryEnd.getTime() > maxEnd) return false
    }
    
    return true
  }
  return false
}

function moveServiceToShift(service, sourceShift, targetShift, shifts, shiftIndex, distanceMatrix) {
  const gaps = findShiftGaps(targetShift)
  
  for (const gap of gaps) {
    let tryStart = new Date(Math.max(
      gap.start.getTime(),
      new Date(service.time.range[0]).getTime()
    ))
    
    const latestPossibleStart = new Date(Math.min(
      gap.end.getTime() - service.duration * 60 * 1000,
      new Date(service.time.range[1]).getTime()
    ))
    
    while (tryStart <= latestPossibleStart) {
      if (canFitServiceAt(service, tryStart, gap, targetShift, distanceMatrix)) {
        // Found a valid spot - move the service
        const serviceIndex = sourceShift.services.findIndex(s => s.id === service.id)
        const movedService = {
          ...service,
          start: tryStart.toISOString(),
          end: new Date(tryStart.getTime() + service.duration * 60 * 1000).toISOString()
          // Don't assign techId or cluster here
        }
        
        targetShift.services.push(movedService)
        sourceShift.services.splice(serviceIndex, 1)
        
        // Sort and update relationships
        targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))
        updateServiceRelationships(targetShift.services, distanceMatrix)
        
        // Remove empty source shift
        if (sourceShift.services.length === 0) {
          shifts.splice(shiftIndex, 1)
        }
        
        return true
      }
      tryStart = new Date(tryStart.getTime() + 60 * 1000)
    }
  }
  
  return false
}

function tryMergeEntireShift(sourceShift, targetShift, distanceMatrix) {
  // Try to fit all services from source into target's gaps
  const gaps = findShiftGaps(targetShift)
  let allFit = true
  
  for (const service of sourceShift.services) {
    let serviceFits = false
    for (const gap of gaps) {
      if (tryFitServiceInGap(service, gap, targetShift, distanceMatrix)) {
        serviceFits = true
        break
      }
    }
    if (!serviceFits) {
      allFit = false
      break
    }
  }
  
  if (allFit) {
    // Move all services without assigning tech/cluster
    for (const service of sourceShift.services) {
      targetShift.services.push({...service})
    }
    
    targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))
    updateServiceRelationships(targetShift.services, distanceMatrix)
    return true
  }
  
  return false
}

function tryMoveServiceToShift(service, sourceShift, targetShift, shifts, shiftIndex, distanceMatrix) {
  const gaps = findShiftGaps(targetShift)
  
  for (const gap of gaps) {
    let tryStart = new Date(Math.max(
      gap.start.getTime(),
      new Date(service.time.range[0]).getTime()
    ))
    
    const latestPossibleStart = new Date(Math.min(
      gap.end.getTime() - service.duration * 60 * 1000,
      new Date(service.time.range[1]).getTime()
    ))
    
    while (tryStart <= latestPossibleStart) {
      if (canFitServiceAt(service, tryStart, gap, targetShift, distanceMatrix)) {
        // Found a valid spot - move the service
        const serviceIndex = sourceShift.services.findIndex(s => s.id === service.id)
        const movedService = {
          ...service,
          start: tryStart.toISOString(),
          end: new Date(tryStart.getTime() + service.duration * 60 * 1000).toISOString()
          // Don't assign techId or cluster here
        }
        
        targetShift.services.push(movedService)
        sourceShift.services.splice(serviceIndex, 1)
        
        // Sort and update relationships
        targetShift.services.sort((a, b) => new Date(a.start) - new Date(b.start))
        updateServiceRelationships(targetShift.services, distanceMatrix)
        
        // Remove empty source shift
        if (sourceShift.services.length === 0) {
          shifts.splice(shiftIndex, 1)
        }
        
        return true
      }
      tryStart = new Date(tryStart.getTime() + 60 * 1000)
    }
  }
  
  return false
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
