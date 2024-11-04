import { addMinutes } from './dateHelpers.js'

export function findGaps({ shift, from, to, minimumGap = 15 }) {
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
      if (gapDuration >= minimumGap) {
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
    if (finalGapDuration >= minimumGap) {
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
  const gapDuration = (gap.end - gap.start) / (60 * 1000) // Convert to minutes

  return (
    serviceDuration <= gapDuration &&
    new Date(service.time.range[0]) <= gap.start &&
    new Date(service.time.range[1]) >= addMinutes(gap.start, serviceDuration)
  )
}
