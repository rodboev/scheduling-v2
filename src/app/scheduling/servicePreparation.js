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
        service.time.range[0] !== null && service.time.range[1] !== null,
    )
    .map(service => ({
      ...service,
      time: {
        ...service.time,
        range: service.time.range.map(date => new Date(date)),
        preferred: new Date(service.time.preferred),
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
  if (services.length <= 1) return services

  const sortedServices = [services[0]]
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
    closestService.distanceFromPrevious = minDistance
    closestService.previousCompany = lastService.company // Add this line
    sortedServices.push(closestService)
  }

  return sortedServices
}
