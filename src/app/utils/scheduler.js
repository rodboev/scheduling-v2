import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, memoizedParseTimeRange, formatTimeRange } from './timeRange'

const MAX_SHIFT_DURATION = 8 * 60 // 8 hours in minutes
const MAX_GAP_BETWEEN_SERVICES = 120 // 2 hours
const MIN_REST_HOURS = 16 // 16 hours minimum rest between shifts
const MAX_BACKTRACK_ATTEMPTS = 5
const MAX_WORK_HOURS = 8 * 60 // 8 hours in minutes

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}

function ensureDate(date) {
  return dayjs.isDayjs(date) ? date.toDate() : date
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function getNextAvailableTechId(techSchedules, nextGenericTechId) {
  const existingIds = Object.keys(techSchedules)
    .filter(id => id.startsWith('Tech '))
    .map(id => {
      const num = parseInt(id.split(' ')[1])
      return isNaN(num) ? 0 : num // Convert NaN to 0
    })
    .sort((a, b) => a - b)

  if (existingIds.length === 0) return nextGenericTechId

  let nextId = nextGenericTechId
  while (existingIds.includes(nextId) || nextId <= Math.max(...existingIds)) {
    nextId++
  }

  return nextId
}

export async function scheduleServices({ services, visibleStart, visibleEnd }, onProgress) {
  console.time('Total scheduling time')

  const techSchedules = {}
  const scheduledServiceIdsByDate = new Map()
  let nextGenericTechId = 1
  const unscheduledServices = []

  // Sort services by date, then by time window size (ascending) and duration (descending)
  console.time('Sorting services')
  services.sort((a, b) => {
    const aDate = dayjs(a.start).startOf('day')
    const bDate = dayjs(b.start).startOf('day')
    if (!aDate.isSame(bDate)) {
      return aDate.diff(bDate)
    }
    const aWindow = memoizedParseTimeRange(a.time.originalRange, a.time.duration)
    const bWindow = memoizedParseTimeRange(b.time.originalRange, b.time.duration)
    const aWindowSize = aWindow[1] - aWindow[0]
    const bWindowSize = bWindow[1] - bWindow[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
  console.timeEnd('Sorting services')

  const totalServices = services.length
  let processedCount = 0

  for (let service of services) {
    // Convert ISO string to Date object if necessary
    service = {
      ...service,
      start: service.start instanceof Date ? service.start : new Date(service.start),
      end: service.end instanceof Date ? service.end : new Date(service.end),
    }

    let scheduled = false
    let reason = ''

    if (service.tech.enforced) {
      scheduled = scheduleEnforcedService(service, techSchedules, scheduledServiceIdsByDate)
      if (!scheduled) {
        reason = 'Could not schedule enforced service'
      }
    }
    else {
      // Try to schedule with existing techs
      for (const techId in techSchedules) {
        const result = scheduleServiceWithRespectToWorkHours(
          service,
          techId,
          techSchedules,
          scheduledServiceIdsByDate,
        )
        if (result.scheduled) {
          scheduled = true
          break
        }
        else {
          reason = result.reason
        }
      }

      // If not scheduled, create a new tech
      if (!scheduled) {
        while (`Tech ${nextGenericTechId}` in techSchedules) {
          nextGenericTechId++
        }
        const newTechId = `Tech ${nextGenericTechId}`
        const result = scheduleServiceWithRespectToWorkHours(
          service,
          newTechId,
          techSchedules,
          scheduledServiceIdsByDate,
        )
        scheduled = result.scheduled
        if (!scheduled) {
          reason = result.reason
        }
      }
    }

    if (!scheduled) {
      unscheduledServices.push({ ...service, reason })
    }

    processedCount++
    const percentage = Math.round((processedCount / totalServices) * 100)
    onProgress(percentage)

    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  // Convert techSchedules to scheduledServices format
  const scheduledServices = Object.entries(techSchedules).flatMap(([techId, schedule]) =>
    schedule.map(service => ({
      ...service,
      start: new Date(service.start),
      end: new Date(service.end),
      resourceId: techId,
    })),
  )

  console.timeEnd('Total scheduling time')

  // Remove any empty tech schedules
  Object.keys(techSchedules).forEach(techId => {
    if (techSchedules[techId].length === 0) {
      delete techSchedules[techId]
    }
  })

  printSummary(techSchedules, unscheduledServices)

  const result = {
    scheduledServices: Object.entries(techSchedules).flatMap(([techId, schedule]) =>
      schedule.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: techId,
      })),
    ),
    unscheduledServices: unscheduledServices.map(service => ({
      ...service,
      start: new Date(service.start),
      end: new Date(service.end),
    })),
    nextGenericTechId,
  }

  return result
}

async function tryScheduleUnscheduledServices(
  unscheduledServices,
  techSchedules,
  scheduledServiceIdsByDate,
  nextGenericTechId,
  onProgress,
  totalServices,
  initialProcessedCount,
) {
  const remainingUnscheduled = []
  let processedCount = initialProcessedCount

  for (const service of unscheduledServices) {
    let scheduled = false
    let reason = ''

    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      const result = findBestSlotForService(service, techId, techSchedules)
      if (result.scheduled) {
        scheduled = true
        const startTime = result.startTime
        const endTime = startTime.add(service.time.duration, 'minute')
        const scheduledService = { ...service, start: startTime.toDate(), end: endTime.toDate() }
        addService(techSchedules[techId], scheduledService)

        const serviceDate = startTime.format('YYYY-MM-DD')
        const serviceKey = `${service.id}-${serviceDate}`
        scheduledServiceIdsByDate.set(serviceKey, techId)
        break
      }
      else {
        reason = result.reason || 'No suitable time slot found'
      }
    }

    // If not scheduled, create a new tech
    if (!scheduled) {
      const newTechId = `Tech ${nextGenericTechId++}`
      techSchedules[newTechId] = []
      const result = findBestSlotForService(service, newTechId, techSchedules)
      if (result.scheduled) {
        const startTime = result.startTime
        const endTime = startTime.add(service.time.duration, 'minute')
        const scheduledService = { ...service, start: startTime.toDate(), end: endTime.toDate() }
        addService(techSchedules[newTechId], scheduledService)

        const serviceDate = startTime.format('YYYY-MM-DD')
        const serviceKey = `${service.id}-${serviceDate}`
        scheduledServiceIdsByDate.set(serviceKey, newTechId)
        scheduled = true
      }
      else {
        reason = result.reason
      }
    }

    if (!scheduled) {
      service.reason = reason
      remainingUnscheduled.push(service)
    }

    processedCount++
    const percentage = Math.min(100, Math.round((processedCount / totalServices) * 100))
    onProgress(percentage)

    // Force a small delay every 10 services to allow for UI updates
    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  return remainingUnscheduled
}

function calculateWorkload(techSchedule, start, end) {
  const dayServices = [
    ...techSchedule.map(e => ({ start: dayjs(e.start), end: dayjs(e.end) })),
    { start: dayjs(start), end: dayjs(end) },
  ].filter(e => e.start.isSame(dayjs(start), 'day'))

  if (dayServices.length === 0) return 0

  dayServices.sort((a, b) => a.start.diff(b.start))
  return dayServices[dayServices.length - 1].end.diff(dayServices[0].start, 'minute')
}

function findBestSlotForService(service, techId, techSchedules) {
  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    service.time.originalRange,
    service.time.duration,
  )
  const earliestStart = dayjs(service.start).startOf('day').add(rangeStart, 'second')
  const latestEnd = dayjs(service.start).startOf('day').add(rangeEnd, 'second')

  const techSchedule = techSchedules[techId] || []
  const gaps = findScheduleGaps(techSchedule, earliestStart, latestEnd)

  let bestSlot = null
  let minGap = Infinity

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= service.time.duration) {
      const potentialStartTime = gap.start
      const potentialEndTime = potentialStartTime.add(service.time.duration, 'minute')

      // Check if this service would exceed the 8-hour limit in a 24-hour period
      const dayStart = potentialStartTime.startOf('day')
      const dayEnd = dayStart.add(1, 'day')
      const dayServices = techSchedule.filter(
        e =>
          dayjs(e.start).isBetween(dayStart, dayEnd, null, '[]') ||
          dayjs(e.end).isBetween(dayStart, dayEnd, null, '[]'),
      )

      const totalWorkMinutes =
        dayServices.reduce((total, e) => {
          const serviceStart = dayjs.max(dayjs(e.start), dayStart)
          const serviceEnd = dayjs.min(dayjs(e.end), dayEnd)
          return total + serviceEnd.diff(serviceStart, 'minute')
        }, 0) + service.time.duration

      if (totalWorkMinutes <= MAX_WORK_HOURS) {
        const gapToNearestService = findGapToNearestService(
          potentialStartTime,
          potentialEndTime,
          techSchedule,
        )
        if (gapToNearestService < minGap) {
          minGap = gapToNearestService
          bestSlot = {
            scheduled: true,
            startTime: potentialStartTime,
            workload: calculateWorkload(techSchedule, potentialStartTime, potentialEndTime),
          }
        }
      }
    }
  }

  return (
    bestSlot || {
      scheduled: false,
      startTime: null,
      workload: Infinity,
      reason: `No suitable time slot found between ${earliestStart.format('h:mma')} and ${latestEnd.format('h:mma')} within 8-hour work limit`,
    }
  )
}

function findGapToNearestService(start, end, schedule) {
  const nearestBefore = schedule
    .filter(e => dayjs(e.end).isBefore(start))
    .reduce((nearest, e) => {
      const gap = start.diff(dayjs(e.end), 'minute')
      return gap < nearest ? gap : nearest
    }, Infinity)

  const nearestAfter = schedule
    .filter(e => dayjs(e.start).isAfter(end))
    .reduce((nearest, e) => {
      const gap = dayjs(e.start).diff(end, 'minute')
      return gap < nearest ? gap : nearest
    }, Infinity)

  return Math.min(nearestBefore, nearestAfter)
}

function scheduleServiceWithBacktracking(
  service,
  techSchedules,
  scheduledServiceIdsByDate,
  nextGenericTechId,
) {
  const backtrackStack = []
  let attempts = 0

  // Attempting to schedule service with backtracking
  while (attempts < MAX_BACKTRACK_ATTEMPTS) {
    // Try to schedule with existing techs
    for (const techId in techSchedules) {
      // Trying to schedule service with existing tech
      const result = scheduleServiceWithRespectToWorkHours(
        service,
        techId,
        techSchedules,
        scheduledServiceIdsByDate,
      )
      if (result.scheduled) {
        // Successfully scheduled service with existing tech
        return { scheduled: true, nextGenericTechId }
      }
      else {
        // Failed to schedule service with existing tech
      }
    }

    // If we couldn't schedule with existing techs, create a new one
    const newTechId = `Tech ${getNextAvailableTechId(techSchedules, nextGenericTechId)}`
    techSchedules[newTechId] = [] // Initialize the new tech's schedule
    const result = scheduleServiceWithRespectToWorkHours(
      service,
      newTechId,
      techSchedules,
      scheduledServiceIdsByDate,
    )
    if (result.scheduled) {
      // Successfully scheduled service with the new tech
      console.log(
        `Scheduled service ${service.id} ${service.company} with new tech ${newTechId}. Reason: ${result.reason}`,
      )
      return { scheduled: true, nextGenericTechId: nextGenericTechId + 1 }
    }

    // Failed to schedule service with the new tech
    console.log(
      `Failed to schedule service ${service.id} ${service.company} with new tech ${newTechId}. Reason: ${result.reason}`,
    )

    // If we still couldn't schedule, backtrack and remove the last service
    if (backtrackStack.length > 0) {
      const { removedService, removedFromTechId } = backtrackStack.pop()
      removeServiceFromSchedule(
        removedService,
        removedFromTechId,
        techSchedules,
        scheduledServiceIdsByDate,
      )
      attempts++
    }
    else {
      // Unable to backtrack to remove the last service
      break
    }
  }

  // Failed to schedule service
  console.log(
    `Failed to schedule service ${service.id} ${service.company} after ${attempts} attempts`,
  )
  return { scheduled: false, nextGenericTechId }
}

function scheduleServiceWithRespectToWorkHours(
  service,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  if (service.time.originalRange.includes('null') || service.time.originalRange.length === 0) {
    return { scheduled: false, reason: 'Improper time range' }
  }

  const [rangeStart, rangeEnd] = memoizedParseTimeRange(
    service.time.originalRange,
    service.time.duration,
  )
  const earliestStart = ensureDayjs(service.start).startOf('day').add(rangeStart, 'second')
  const latestEnd = ensureDayjs(service.start).startOf('day').add(rangeEnd, 'second')

  if (!techSchedules[techId]) {
    techSchedules[techId] = []
  }

  const schedule = techSchedules[techId]
  const gaps = findScheduleGaps(schedule, earliestStart, latestEnd)

  for (const gap of gaps) {
    if (gap.end.diff(gap.start, 'minute') >= service.time.duration) {
      const startTime = gap.start
      const endTime = startTime.add(service.time.duration, 'minute')

      if (isWithinWorkHours(schedule, startTime, endTime)) {
        const scheduledService = {
          ...service,
          start: ensureDate(startTime),
          end: ensureDate(endTime),
        }
        addService(schedule, scheduledService)

        const serviceDate = startTime.format('YYYY-MM-DD')
        const serviceKey = `${service.id}-${serviceDate}`
        scheduledServiceIdsByDate.set(serviceKey, techId)

        return { scheduled: true, reason: null }
      }
    }
  }

  return {
    scheduled: false,
    reason: `No available time slot found between ${earliestStart.format('h:mma')} and ${latestEnd.format('h:mma')} on ${earliestStart.format('M/D')} for ${techId}`,
  }
}

function isWithinWorkHours(schedule, start, end) {
  const serviceStart = ensureDayjs(start)
  const serviceEnd = ensureDayjs(end)
  const dayStart = serviceStart.startOf('day')
  const nextDayStart = dayStart.add(1, 'day')

  const dayServices = [
    ...schedule.map(e => ({ start: ensureDayjs(e.start), end: ensureDayjs(e.end) })),
    { start: serviceStart, end: serviceEnd },
  ].filter(
    e =>
      (e.start.isSameOrAfter(dayStart) && e.start.isBefore(nextDayStart)) ||
      (e.end.isAfter(dayStart) && e.end.isSameOrBefore(nextDayStart)) ||
      (e.start.isBefore(dayStart) && e.end.isAfter(nextDayStart)),
  )

  if (dayServices.length === 0) {
    return true
  }

  dayServices.sort((a, b) => a.start.diff(b.start))

  let shiftStart = dayServices[0].start
  let shiftEnd = dayServices[0].end

  for (let i = 1; i < dayServices.length; i++) {
    const currentService = dayServices[i]
    const timeSinceLastService = currentService.start.diff(shiftEnd, 'hour')

    if (timeSinceLastService >= MIN_REST_HOURS) {
      // Check if the previous shift exceeded MAX_SHIFT_DURATION
      if (shiftEnd.diff(shiftStart, 'minute') > MAX_SHIFT_DURATION) {
        return false
      }
      // Start a new shift
      shiftStart = currentService.start
    }

    shiftEnd = currentService.end
  }

  // Check the final shift duration
  const finalShiftDuration = shiftEnd.diff(shiftStart, 'minute')
  return finalShiftDuration <= MAX_SHIFT_DURATION
}

function calculateShiftDuration(services) {
  if (services.length === 0) return 0

  const shiftStart = ensureDayjs(services[0].start)
  const shiftEnd = ensureDayjs(services[services.length - 1].end)

  return shiftEnd.diff(shiftStart, 'minute')
}

function isIsolatedService(services, index) {
  const service = services[index]
  const prevService = index > 0 ? services[index - 1] : null
  const nextService = index < services.length - 1 ? services[index + 1] : null

  const gapBefore = prevService
    ? ensureDayjs(service.start).diff(ensureDayjs(prevService.end), 'minute')
    : Infinity
  const gapAfter = nextService
    ? ensureDayjs(nextService.start).diff(ensureDayjs(service.end), 'minute')
    : Infinity

  return gapBefore > MAX_GAP_BETWEEN_SERVICES && gapAfter > MAX_GAP_BETWEEN_SERVICES
}

function findBestStartTimeInGap(gap, duration, schedule) {
  const gapStart = gap.start
  const gapEnd = gap.end.subtract(duration, 'minute')

  if (gapEnd.isBefore(gapStart)) {
    return gapStart
  }

  const nearestService = findNearestService(gap, schedule)

  if (!nearestService) {
    return gapStart
  }

  if (nearestService.end.isBefore(gap.start)) {
    return gapStart
  }

  if (nearestService.start.isAfter(gap.end)) {
    return gapEnd
  }

  // Try to schedule as close as possible to the nearest service
  if (nearestService.end.isBefore(gapStart)) {
    return gapStart
  }
  else if (nearestService.start.isAfter(gapEnd)) {
    return gapEnd
  }
  else {
    const middleOfGap = gapStart.add(gapEnd.diff(gapStart) / 2, 'minute')
    return middleOfGap
  }
}

function findNearestService(gap, schedule) {
  return schedule.reduce((nearest, service) => {
    const serviceStart = ensureDayjs(service.start)
    const serviceEnd = ensureDayjs(service.end)
    const distanceToStart = Math.abs(gap.start.diff(serviceStart, 'minute'))
    const distanceToEnd = Math.abs(gap.start.diff(serviceEnd, 'minute'))
    const distance = Math.min(distanceToStart, distanceToEnd)

    if (!nearest || distance < nearest.distance) {
      return { start: serviceStart, end: serviceEnd, distance }
    }
    return nearest
  }, null)
}

function findScheduleGaps(schedule, start, end) {
  const gaps = []
  let currentTime = ensureDayjs(start)
  const endTime = ensureDayjs(end)

  schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

  let lastServiceEnd = null

  schedule.forEach(service => {
    const serviceStart = ensureDayjs(service.start)
    const serviceEnd = ensureDayjs(service.end)

    if (lastServiceEnd && serviceStart.diff(lastServiceEnd, 'hour') >= MIN_REST_HOURS) {
      // Add a gap that respects the minimum rest period
      gaps.push({ start: lastServiceEnd.add(MIN_REST_HOURS, 'hour'), end: serviceStart })
    }
    else if (serviceStart.isAfter(currentTime)) {
      gaps.push({ start: currentTime, end: serviceStart })
    }

    currentTime = dayjs.max(currentTime, serviceEnd)
    lastServiceEnd = serviceEnd
  })

  if (endTime.isAfter(currentTime)) {
    if (lastServiceEnd && endTime.diff(lastServiceEnd, 'hour') >= MIN_REST_HOURS) {
      // Add a final gap that respects the minimum rest period
      gaps.push({ start: lastServiceEnd.add(MIN_REST_HOURS, 'hour'), end: endTime })
    }
    else {
      gaps.push({ start: currentTime, end: endTime })
    }
  }

  return gaps
}

function addService(schedule, service) {
  const index = schedule.findIndex(e => ensureDayjs(e.start).isAfter(ensureDayjs(service.start)))
  if (index === -1) {
    schedule.push(service)
  }
  else {
    schedule.splice(index, 0, service)
  }
}

function removeServiceFromSchedule(service, techId, techSchedules, scheduledServiceIdsByDate) {
  techSchedules[techId] = techSchedules[techId].filter(e => e.id !== service.id)
  const serviceDate = ensureDayjs(service.start).format('YYYY-MM-DD')
  const serviceKey = `${service.id}-${serviceDate}`
  scheduledServiceIdsByDate.delete(serviceKey)
}

function scheduleEnforcedService(service, techSchedules, scheduledServiceIdsByDate) {
  const techId = service.tech.code
  if (!techSchedules[techId]) techSchedules[techId] = []

  const preferredTime = parseTime(service.time.preferred)
  const startTime = ensureDayjs(service.start).startOf('day').add(preferredTime, 'second')
  const endTime = startTime.add(service.time.duration, 'minute')

  techSchedules[techId].push({
    ...service,
    start: startTime,
    end: endTime,
  })

  const serviceDate = startTime.format('YYYY-MM-DD')
  const serviceKey = `${service.id}-${serviceDate}`
  scheduledServiceIdsByDate.set(serviceKey, techId)

  return true
}

function printSummary(techSchedules, unscheduledServices) {
  let scheduleSummary = 'Schedule Summary:\n\n'

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    let techSummary = `${techId}:\n`

    // Group services by day
    const daySchedules = new Map()
    schedule.forEach(service => {
      const day = ensureDayjs(service.start).startOf('day').format('YYYY-MM-DD')
      if (!daySchedules.has(day)) {
        daySchedules.set(day, [])
      }
      daySchedules.get(day).push(service)
    })

    // Print services and calculate shift duration for each day
    for (const [day, services] of daySchedules) {
      services.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

      services.forEach(service => {
        const date = ensureDayjs(service.start).format('M/D')
        const start = ensureDayjs(service.start).format('h:mma')
        const end = ensureDayjs(service.end).format('h:mma')
        techSummary += `- ${date}, ${start}-${end}, ${service.company} (id: ${service.id})\n`
      })

      const shiftDuration = calculateShiftDuration(services)
      const shiftDurationHours = (shiftDuration / 60).toFixed(1)
      techSummary += `Shift duration: ${shiftDurationHours} hours\n\n`
    }

    if (schedule.length > 0) {
      scheduleSummary += techSummary
    }
  })

  // Unassigned services
  if (unscheduledServices.length > 0) {
    scheduleSummary += 'Unassigned services:\n'
    unscheduledServices.forEach(service => {
      const date = ensureDayjs(service.start).format('M/D')
      const timeWindow = formatTimeRange(service.time.range[0], service.time.range[1])
      scheduleSummary += `- ${date}, ${timeWindow} time window, ${service.company} (id: ${service.id}), Reason: ${service.reason}\n`
    })

    // Log services with time range issues
    const reasonToFilter = 'time range'
    const servicesWithTimeIssues = [
      ...new Set(
        unscheduledServices
          .filter(e => e.reason.includes(reasonToFilter))
          .map(e => ({
            id: e.id.split('-')[0],
            reason: e.reason,
          })),
      ),
    ]
    if (servicesWithTimeIssues.length > 0) {
      scheduleSummary += `\nUnscheduled due to ${reasonToFilter} issues (${servicesWithTimeIssues.length}): ${servicesWithTimeIssues.map(e => e.id).join(', ')}`
      for (const service of servicesWithTimeIssues) {
        scheduleSummary += `\n- ${service.id}: ${service.reason}`
      }
    }
  }

  console.log(scheduleSummary)
}
