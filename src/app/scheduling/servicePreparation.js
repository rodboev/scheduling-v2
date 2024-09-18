import { ensureDayjs } from '@/app/utils/dayjs'

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
  services.sort((a, b) => {
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
