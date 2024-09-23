import { calcDistance } from './index.js'

export function filterInvalidServices(services) {
  return services
    .filter(
      service =>
        service.time.range[0] === null || service.time.range[1] === null,
    )
    .map(service => ({ ...service, reason: 'Invalid time range' }))
}

export function prepareServicesToSchedule(services) {
  return services
    .filter(
      service =>
        service.time.range[0] !== null &&
        service.time.range[1] !== null &&
        !isNaN(new Date(service.time.range[0]).getTime()) &&
        !isNaN(new Date(service.time.range[1]).getTime()),
    )
    .map(service => ({
      ...service,
      time: {
        ...service.time,
        range: service.time.range.map(date => new Date(date)),
        preferred: service.time.preferred
          ? new Date(service.time.preferred)
          : null,
      },
      date: new Date(service.date),
    }))
}

export function sortServices(services) {
  return services.sort((a, b) => {
    const aDate = new Date(a.time.range[0])
    const bDate = new Date(b.time.range[0])
    aDate.setHours(0, 0, 0, 0)
    bDate.setHours(0, 0, 0, 0)
    if (aDate.getTime() !== bDate.getTime()) {
      return aDate.getTime() - bDate.getTime()
    }
    const aWindowSize = new Date(a.time.range[1]) - new Date(a.time.range[0])
    const bWindowSize = new Date(b.time.range[1]) - new Date(b.time.range[0])
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
}

export function sortServicesByProximity(services) {
  if (services.length <= 1) return { sortedServices: services, distances: [] }

  const sortedServices = [services[0]]
  const distances = []
  const remainingServices = services.slice(1)

  while (remainingServices.length > 0) {
    const lastService = sortedServices[sortedServices.length - 1]
    let closestServiceIndex = 0
    let minDistance = calcDistance(
      lastService.location,
      remainingServices[0].location,
    )

    for (let i = 1; i < remainingServices.length; i++) {
      const distance = calcDistance(
        lastService.location,
        remainingServices[i].location,
      )
      if (distance < minDistance) {
        minDistance = distance
        closestServiceIndex = i
      }
    }

    const closestService = remainingServices.splice(closestServiceIndex, 1)[0]
    distances.push(minDistance)
    sortedServices.push(closestService)
  }

  return { sortedServices, distances }
}

export function sortServicesByTimeAndProximity(
  services,
  proximityWeight = 0.9,
) {
  if (services.length <= 1) return services

  // First, sort by time
  const timeSortedServices = sortServices([...services])

  // Then, apply proximity sorting with weighting
  const result = [timeSortedServices[0]]
  const remaining = timeSortedServices.slice(1)

  while (remaining.length > 0) {
    const lastService = result[result.length - 1]
    let bestIndex = 0
    let bestScore = Infinity

    for (let i = 0; i < remaining.length; i++) {
      const currentService = remaining[i]
      const timeScore =
        Math.abs(
          new Date(currentService.time.range[0]) -
            new Date(lastService.time.range[1]),
        ) /
        (1000 * 60 * 60) // Time difference in hours
      const distanceScore = calcDistance(
        lastService.location,
        currentService.location,
      )

      const score =
        timeScore * (1 - proximityWeight) + distanceScore * proximityWeight

      if (score < bestScore) {
        bestScore = score
        bestIndex = i
      }
    }

    const nextService = remaining.splice(bestIndex, 1)[0]
    result.push(nextService)
  }

  return result
}

export function findClosestService(baseService, services, maxDistance = 10) {
  let closestService = null
  let minDistance = Infinity

  for (const service of services) {
    const distance = calcDistance(baseService.location, service.location)
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance
      closestService = service
    }
  }

  return closestService
}
