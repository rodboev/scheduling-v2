import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'

const SHIFT_DURATION = 8 * 60 // 8 hours in minutes
const TIME_INCREMENT = 15 // 15 minute increments
const MAX_TIME_SEARCH = 2 * 60 // 2 hours in minutes
const MAX_TRAVEL_TIME = 15 // maximum travel time between services in minutes

function checkTimeOverlap(existingStart, existingEnd, newStart, newEnd) {
  if (newStart.getTime() === existingEnd.getTime() || 
      existingStart.getTime() === newEnd.getTime()) {
    return false
  }
  
  return (
    (newStart < existingEnd && newStart >= existingStart) ||
    (newEnd > existingStart && newEnd <= existingEnd) ||
    (newStart <= existingStart && newEnd >= existingEnd)
  )
}

function calculateTravelTime(distanceMatrix, fromIndex, toIndex) {
  const distance = distanceMatrix[fromIndex][toIndex]
  return distance ? Math.ceil(distance * 2) : MAX_TRAVEL_TIME // Assume 30 mph average speed
}

function roundToNearestInterval(date) {
  const minutes = date.getMinutes()
  const roundedMinutes = Math.ceil(minutes / TIME_INCREMENT) * TIME_INCREMENT
  const newDate = new Date(date)
  newDate.setMinutes(roundedMinutes)
  return newDate
}

function findBestNextService(currentService, remainingServices, distanceMatrix, shiftEnd, scheduledServices) {
  let bestService = null
  let bestScore = -Infinity
  let bestStart = null
  
  const currentIndex = currentService.originalIndex
  
  for (const service of remainingServices) {
    const travelTime = calculateTravelTime(distanceMatrix, currentIndex, service.originalIndex)
    let earliestPossibleStart = new Date(
      new Date(currentService.end).getTime() + travelTime * 60000
    )
    
    // Round to nearest 15-minute interval
    earliestPossibleStart = roundToNearestInterval(earliestPossibleStart)
    
    // Skip if service can't start after travel time or would end after shift
    const serviceEnd = new Date(
      earliestPossibleStart.getTime() + service.time.duration * 60000
    )
    if (serviceEnd > shiftEnd) continue
    
    // Check for conflicts with already scheduled services
    let hasConflict = false
    for (const scheduled of scheduledServices) {
      if (checkTimeOverlap(
        new Date(scheduled.start),
        new Date(scheduled.end),
        earliestPossibleStart,
        serviceEnd
      )) {
        hasConflict = true
        break
      }
    }
    if (hasConflict) continue
    
    // Score based on travel time and time gap
    const timeGap = (earliestPossibleStart - new Date(currentService.end)) / 60000
    const score = -travelTime - (timeGap / 2) // Prioritize shorter travel times and gaps
    
    if (score > bestScore) {
      bestScore = score
      bestService = service
      bestStart = earliestPossibleStart
    }
  }
  
  return bestService ? { service: bestService, start: bestStart } : null
}

function createShifts(services, distanceMatrix) {
  // Add original indices to services for distance matrix lookup
  const servicesWithIndices = services.map((service, index) => ({
    ...service,
    originalIndex: index
  }))
  
  // Sort all services by earliest possible start time
  const sortedServices = [...servicesWithIndices].sort(
    (a, b) => new Date(a.time.range[0]) - new Date(b.time.range[0])
  )
  
  const shifts = []
  let remainingServices = [...sortedServices]
  
  while (remainingServices.length > 0) {
    const currentShift = {
      services: [],
      startTime: null,
      endTime: null
    }
    
    // Start new shift with earliest available service
    const firstService = remainingServices[0]
    const shiftStart = new Date(firstService.time.range[0])
    const shiftEnd = new Date(shiftStart.getTime() + SHIFT_DURATION * 60000)
    
    currentShift.startTime = shiftStart
    currentShift.endTime = shiftEnd
    
    // Add first service to shift
    currentShift.services.push({
      ...firstService,
      cluster: shifts.length,
      start: shiftStart.toISOString(),
      end: new Date(shiftStart.getTime() + firstService.time.duration * 60000).toISOString()
    })
    
    remainingServices.splice(0, 1)
    
    // Keep adding services until we can't fit any more
    let currentService = currentShift.services[0]
    while (true) {
      const next = findBestNextService(
        currentService,
        remainingServices,
        distanceMatrix,
        shiftEnd,
        currentShift.services
      )
      
      if (!next) break
      
      // Add service to shift and remove from remaining
      const { service, start } = next
      const scheduledService = {
        ...service,
        cluster: shifts.length,
        start: start.toISOString(),
        end: new Date(start.getTime() + service.time.duration * 60000).toISOString()
      }
      
      currentShift.services.push(scheduledService)
      remainingServices = remainingServices.filter(s => s.originalIndex !== service.originalIndex)
      currentService = scheduledService
    }
    
    shifts.push(currentShift)
  }
  
  return shifts
}

parentPort.on(
  'message',
  async ({ services, distanceMatrix }) => {
    const startTime = performance.now()

    try {
      // Create optimized 8-hour shifts
      const shifts = createShifts(services, distanceMatrix)
      
      // Flatten all services from all shifts
      const clusteredServices = shifts.flatMap(shift => shift.services)
      
      const endTime = performance.now()
      const duration = endTime - startTime

      const clusteringInfo = {
        algorithm: 'shifts',
        performanceDuration: Number.parseInt(duration),
        connectedPointsCount: services.length,
        outlierCount: 0,
        totalClusters: shifts.length,
        clusterSizes: shifts.map(shift => shift.services.length),
        clusterDistribution: shifts.map((shift, index) => ({ 
          [index]: shift.services.length 
        })),
        shifts: shifts.map(shift => ({
          startTime: shift.startTime,
          endTime: shift.endTime,
          serviceCount: shift.services.length
        }))
      }

      parentPort.postMessage({
        clusteredServices,
        clusteringInfo,
      })
    } catch (error) {
      console.error('Error in clustering worker:', error)
      parentPort.postMessage({
        error: error.message,
        clusteringInfo: {
          algorithm: 'shifts',
        },
      })
    }
  }
)

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})