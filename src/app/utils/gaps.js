import { addMinutes } from './dateHelpers.js'

export function findGaps({ shift, from, to }) {
  const gaps = []
  let currentTime = new Date(from)
  const endTime = new Date(to)

  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start) - new Date(b.start)
  )

  for (const service of sortedServices) {
    const serviceStart = new Date(service.start)
    const serviceEnd = new Date(service.end)

    // Check if there's a gap before this service
    if (serviceStart > currentTime) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
        duration: (serviceStart - currentTime) / (60 * 1000)
      })
    }
    currentTime = serviceEnd
  }

  // Check for gap after last service
  if (endTime > currentTime) {
    gaps.push({
      start: currentTime,
      end: endTime,
      duration: (endTime - currentTime) / (60 * 1000)
    })
  }

  return gaps
}

export function canFitInGap(service, gap, prevService, nextService, distanceMatrix) {
  const serviceDuration = service.time.duration
  
  // Calculate travel times if applicable
  const prevTravelTime = prevService ? calculateTravelTime(getDistance(prevService, service, distanceMatrix)) : 0
  const nextTravelTime = nextService ? calculateTravelTime(getDistance(service, nextService, distanceMatrix)) : 0
  
  // Total time needed including travel
  const totalDuration = serviceDuration + prevTravelTime + nextTravelTime
  const gapDuration = (gap.end - gap.start) / (60 * 1000)

  // First check basic fit
  if (totalDuration > gapDuration) return false

  const serviceEarliestStart = new Date(Math.max(
    gap.start.getTime() + prevTravelTime * 60000,
    new Date(service.time.range[0]).getTime()
  ))
  const serviceLatestStart = new Date(service.time.range[1])

  // Check time window compatibility
  if (serviceEarliestStart > gap.end || 
      serviceLatestStart < addMinutes(gap.start, totalDuration) ||
      gap.end < addMinutes(serviceEarliestStart, totalDuration)) {
    return false
  }

  // Calculate fit score
  const distanceScore = prevService ? 1 - (getDistance(prevService, service, distanceMatrix) / HARD_MAX_RADIUS_MILES) : 1
  const timeScore = service.time.preferred ? 
    1 - Math.abs(serviceEarliestStart - new Date(service.time.preferred)) / (4 * 60 * 60 * 1000) : 0
  const boroughScore = prevService?.location?.latitude && prevService?.location?.longitude && 
    service?.location?.latitude && service?.location?.longitude && 
    areSameBorough(
      prevService.location.latitude,
      prevService.location.longitude,
      service.location.latitude,
      service.location.longitude
    ) ? 0.5 : 0
  const utilizationScore = totalDuration / gapDuration

  const totalScore = (distanceScore * 0.3 + timeScore * 0.3 + boroughScore * 0.2 + utilizationScore * 0.2)

  // Return true only if score meets minimum threshold
  return totalScore > 0.4 // Adjust threshold as needed
}

// Find all gaps in a shift that are large enough for a given service
export function findShiftGaps(shift) {
  if (!shift.services || shift.services.length === 0) {
    return [{
      start: shift.startTime,
      end: shift.endTime,
      duration: (shift.endTime - shift.startTime) / (60 * 1000)
    }]
  }

  const gaps = []
  let currentTime = shift.startTime

  // Sort services by start time
  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start) - new Date(b.start)
  )

  for (const service of sortedServices) {
    const serviceStart = new Date(service.start)
    const serviceEnd = new Date(service.end)

    // Check for gap before this service
    if (serviceStart > currentTime) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
        duration: (serviceStart - currentTime) / (60 * 1000)
      })
    }
    currentTime = serviceEnd
  }

  // Check for gap after last service
  if (shift.endTime > currentTime) {
    gaps.push({
      start: currentTime,
      end: shift.endTime,
      duration: (shift.endTime - currentTime) / (60 * 1000)
    })
  }

  return gaps
}
