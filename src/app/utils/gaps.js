import { addMinutes } from './dateHelpers.js'

const MINIMUM_GAP_MINUTES = 30

export function findGaps({ shift, from, to }) {
  const gaps = []
  let currentTime = new Date(from)
  const endTime = new Date(to)

  // Early return if no services
  if (!shift.services || shift.services.length === 0) {
    if (endTime > currentTime) {
      gaps.push({ start: currentTime, end: endTime })
    }
    return gaps
  }

  // Sort services by start time
  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start) - new Date(b.start),
  )

  for (const service of sortedServices) {
    const serviceStart = new Date(service.start)
    const serviceEnd = new Date(service.end)

    // Check if there's a gap before this service
    if (serviceStart > currentTime) {
      const gapDuration = (serviceStart - currentTime) / (60 * 1000) // minutes
      if (gapDuration >= MINIMUM_GAP_MINUTES) {
        gaps.push({
          start: currentTime,
          end: serviceStart,
          duration: gapDuration / 60, // Convert to hours
        })
      }
    }

    currentTime = serviceEnd > currentTime ? serviceEnd : currentTime
  }

  // Check for gap after last service
  if (endTime > currentTime) {
    const finalGapDuration = (endTime - currentTime) / (60 * 1000)
    if (finalGapDuration >= MINIMUM_GAP_MINUTES) {
      gaps.push({
        start: currentTime,
        end: endTime,
        duration: finalGapDuration / 60,
      })
    }
  }

  return gaps
}

export function canFitInGap(service, gap) {
  const serviceDuration = service.time.duration
  const gapDuration = (gap.end - gap.start) / (60 * 1000)

  const serviceEarliestStart = new Date(service.time.range[0])
  const serviceLatestStart = new Date(service.time.range[1])

  return (
    serviceDuration <= gapDuration &&
    serviceEarliestStart <= gap.end &&
    serviceLatestStart >= addMinutes(gap.start, serviceDuration) &&
    gap.end >= addMinutes(serviceEarliestStart, serviceDuration)
  )
}

// Find all gaps in a shift that are large enough for a given service
export function findShiftGaps(shift) {
  if (!shift.services || shift.services.length === 0) {
    return [{
      start: shift.startTime,
      end: shift.endTime,
      duration: (shift.endTime - shift.startTime) / (60 * 60 * 1000)
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
      const gapDuration = (serviceStart - currentTime) / (60 * 1000)
      if (gapDuration >= MINIMUM_GAP_MINUTES) {
        gaps.push({
          start: currentTime,
          end: serviceStart,
          duration: gapDuration / 60
        })
      }
    }
    currentTime = serviceEnd
  }

  // Check for gap after last service
  if (shift.endTime > currentTime) {
    const finalGapDuration = (shift.endTime - currentTime) / (60 * 1000)
    if (finalGapDuration >= MINIMUM_GAP_MINUTES) {
      gaps.push({
        start: currentTime,
        end: shift.endTime,
        duration: finalGapDuration / 60
      })
    }
  }

  return gaps
}
