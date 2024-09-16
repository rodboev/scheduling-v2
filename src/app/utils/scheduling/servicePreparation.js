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
      // Convert all date fields in services to dayjs objects
      ...service,
      time: {
        ...service.time,
        range: service.time.range.map(ensureDayjs),
        preferred: ensureDayjs(service.time.preferred),
      },
      date: ensureDayjs(service.date),
    }))
}

export function sortServices(services) {
  // Sort services by date, then by time window size (ascending) and duration (descending)
  services.sort((a, b) => {
    const aDate = a.time.range[0].startOf('day')
    const bDate = b.time.range[0].startOf('day')
    if (!aDate.isSame(bDate)) {
      return aDate.diff(bDate)
    }
    const aWindowSize = a.time.range[1].diff(a.time.range[0], 'minute')
    const bWindowSize = b.time.range[1].diff(b.time.range[0], 'minute')
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
}
