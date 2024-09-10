import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, formatTimeRange } from './timeRange'

const MAX_SHIFT_DURATION = 8 * 60 // 8 hours in minutes
const MAX_GAP_BETWEEN_SERVICES = 7 * 60 // 8 hours minus two 30 minute services
const MIN_REST_HOURS = 16 // 16 hours minimum rest between shifts

function ensureDayjs(date) {
  return dayjs.isDayjs(date) ? date : dayjs(date)
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function scheduleServices(
  { services, visibleStart, visibleEnd },
  onProgress,
) {
  console.time('Total time')
  console.time('Total scheduling time')

  const techSchedules = {}
  const scheduledServiceIdsByDate = new Map()
  let nextGenericTechId = 1
  const unscheduledServices = []

  // Ensure visibleStart and visibleEnd are dayjs objects
  visibleStart = ensureDayjs(visibleStart)
  visibleEnd = ensureDayjs(visibleEnd)

  // Convert all date fields in services to dayjs objects
  services = services.map(service => ({
    ...service,
    start: ensureDayjs(service.start),
    end: ensureDayjs(service.end),
  }))

  // Sort services by date, then by time window size (ascending) and duration (descending)
  console.time('Sorting services')
  services.sort((a, b) => {
    const aDate = a.start.startOf('day')
    const bDate = b.start.startOf('day')
    if (!aDate.isSame(bDate)) {
      return aDate.diff(bDate)
    }
    const aWindowSize = a.time.range[1] - a.time.range[0]
    const bWindowSize = b.time.range[1] - b.time.range[0]
    return aWindowSize - bWindowSize || b.time.duration - a.time.duration
  })
  console.timeEnd('Sorting services')

  const totalServices = services.length
  let processedCount = 0

  for (let service of services) {
    let scheduled = false
    let reason = ''

    const serviceSetupId = service.id.split('-')[0]

    if (service.tech.enforced && service.tech.code) {
      // Attempt to schedule enforced service with named tech
      scheduled = scheduleEnforcedService(
        service,
        techSchedules,
        scheduledServiceIdsByDate,
      )
      if (!scheduled) {
        reason = 'Could not schedule enforced service'
        console.log(
          `Failed to schedule enforced service ${serviceSetupId}: ${reason}`,
        )
      }
    } else {
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
        } else {
          reason = result.reason
        }
      }

      // If not scheduled, create a new tech
      if (!scheduled) {
        while (`Tech ${nextGenericTechId}` in techSchedules) {
          nextGenericTechId++
        }
        const newTechId = `Tech ${nextGenericTechId}`
        techSchedules[newTechId] = []
        const result = scheduleServiceWithRespectToWorkHours(
          service,
          newTechId,
          techSchedules,
          scheduledServiceIdsByDate,
        )
        scheduled = result.scheduled
        if (!scheduled) {
          reason = result.reason
        } else {
          nextGenericTechId++
        }
      }
    }

    if (!scheduled) {
      unscheduledServices.push({ ...service, reason })
    }

    processedCount++
    const progress = Math.round((processedCount / totalServices) * 100)
    onProgress(progress)

    if (processedCount % 10 === 0) {
      await delay(0)
    }
  }

  // // Compact all schedules after initial scheduling
  // for (const techId in techSchedules) {
  //   techSchedules[techId] = compactSchedule(techSchedules[techId])
  // }

  console.timeEnd('Total scheduling time')

  printSummary(techSchedules, unscheduledServices)

  // Convert techSchedules to scheduledServices format
  const scheduledServices = Object.entries(techSchedules).flatMap(
    ([techId, schedule]) =>
      schedule.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: techId,
      })),
  )

  // Convert unscheduledServices dates to Date objects
  const formattedUnscheduledServices = unscheduledServices.map(service => ({
    ...service,
    start: new Date(service.start),
    end: new Date(service.end),
  }))

  console.timeEnd('Total time')

  return {
    scheduledServices,
    unscheduledServices: formattedUnscheduledServices,
    techSchedules,
  }
}

function scheduleServiceWithRespectToWorkHours(
  service,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  if (
    service.time.originalRange.includes('null') ||
    service.time.originalRange.length === 0
  ) {
    return { scheduled: false, reason: 'Improper time range' }
  }

  const [rangeStart, rangeEnd] = [service.time.range[0], service.time.range[1]]
  const earliestStart = service.start.startOf('day').add(rangeStart, 'second')
  const latestEnd = service.start.startOf('day').add(rangeEnd, 'second')
  const preferredTime = service.time.preferred
    ? parseTime(service.time.preferred)
    : rangeStart

  if (!techSchedules[techId]) {
    techSchedules[techId] = []
  }

  const schedule = techSchedules[techId].map(s => ({
    ...s,
    start: ensureDayjs(s.start),
    end: ensureDayjs(s.end),
  }))

  const gaps = findScheduleGaps(schedule, earliestStart, latestEnd)

  for (const gap of gaps) {
    const gapStart = dayjs.max(gap.start, earliestStart)
    const gapEnd = dayjs.min(gap.end, latestEnd)
    const preferredStart = dayjs.max(
      gapStart,
      service.start.startOf('day').add(preferredTime, 'second'),
    )

    if (gapEnd.diff(gapStart, 'minute') >= service.time.duration) {
      let startTime = preferredStart
      if (startTime.add(service.time.duration, 'minute').isAfter(gapEnd)) {
        startTime = gapEnd.subtract(service.time.duration, 'minute')
      }
      const endTime = startTime.add(service.time.duration, 'minute')

      if (
        startTime.isSameOrAfter(gapStart) &&
        endTime.isSameOrBefore(gapEnd) &&
        isWithinWorkHours(schedule, startTime, endTime)
      ) {
        const scheduledService = {
          ...service,
          start: startTime.toDate(),
          end: endTime.toDate(),
        }
        techSchedules[techId].push(scheduledService)
        techSchedules[techId].sort((a, b) =>
          dayjs(a.start).diff(dayjs(b.start)),
        )

        const serviceDate = startTime.format('YYYY-MM-DD')
        const serviceKey = `${service.id}-${serviceDate}`
        scheduledServiceIdsByDate.set(serviceKey, techId)

        return { scheduled: true, reason: null }
      }
    }
  }

  return {
    scheduled: false,
    reason: `No available time slot found within the time range ${earliestStart.format('h:mma')}-${latestEnd.format('h:mma')} on ${earliestStart.format('M/D')} for ${techId}`,
  }
}

function isWithinWorkHours(schedule, start, end) {
  const dayStart = start.startOf('day')
  const prevDayStart = dayStart.subtract(1, 'day')
  const nextDayStart = dayStart.add(1, 'day')

  const dayServices = [...schedule, { start, end }].filter(
    e =>
      (e.start.isSameOrAfter(dayStart) && e.start.isBefore(nextDayStart)) ||
      (e.end.isAfter(dayStart) && e.end.isSameOrBefore(nextDayStart)) ||
      (e.start.isBefore(dayStart) && e.end.isAfter(nextDayStart)),
  )

  if (dayServices.length === 0) {
    // No services for the day, returning true
    return true
  }

  dayServices.sort((a, b) => a.start.diff(b.start))

  let shiftStart = dayServices[0].start
  let shiftEnd = dayServices[0].end

  // Check if there's a previous day shift that ended less than MIN_REST_HOURS ago
  const previousDayServices = schedule.filter(
    e => e.end.isSameOrAfter(prevDayStart) && e.end.isBefore(dayStart),
  )
  if (previousDayServices.length > 0) {
    const lastPreviousDayShift =
      previousDayServices[previousDayServices.length - 1]
    if (shiftStart.diff(lastPreviousDayShift.end, 'hour') < MIN_REST_HOURS) {
      return false
    }
  }

  for (let i = 1; i < dayServices.length; i++) {
    const currentService = dayServices[i]
    const timeSinceLastService = currentService.start.diff(shiftEnd, 'hour')

    if (timeSinceLastService >= MIN_REST_HOURS) {
      if (shiftEnd.diff(shiftStart, 'minute') > MAX_SHIFT_DURATION) {
        // Shift duration exceeded, returning false
        return false
      }
      shiftStart = currentService.start
    }

    shiftEnd = currentService.end
  }

  const finalShiftDuration = shiftEnd.diff(shiftStart, 'minute')
  const result = finalShiftDuration <= MAX_SHIFT_DURATION
  return result
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

    if (
      lastServiceEnd &&
      serviceStart.diff(lastServiceEnd, 'hour') >= MIN_REST_HOURS
    ) {
      // Add a gap that respects the minimum rest period
      gaps.push({
        start: lastServiceEnd.add(MIN_REST_HOURS, 'hour'),
        end: serviceStart,
      })
    } else if (serviceStart.isAfter(currentTime)) {
      gaps.push({ start: currentTime, end: serviceStart })
    }

    currentTime = serviceEnd.isAfter(currentTime) ? serviceEnd : currentTime
    lastServiceEnd = serviceEnd
  })

  if (endTime.isAfter(currentTime)) {
    if (
      lastServiceEnd &&
      endTime.diff(lastServiceEnd, 'hour') >= MIN_REST_HOURS
    ) {
      // Add a final gap that respects the minimum rest period
      gaps.push({
        start: lastServiceEnd.add(MIN_REST_HOURS, 'hour'),
        end: endTime,
      })
    } else {
      gaps.push({ start: currentTime, end: endTime })
    }
  }

  return gaps
}

function scheduleEnforcedService(
  service,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  // No need to respect time range for enforced services
  const techId = service.tech.code
  if (!techId) {
    console.log(
      `Warning: Enforced service ${service.id} has no tech code. Skipping enforcement.`,
    )
    return false
  }

  if (!techSchedules[techId]) techSchedules[techId] = []

  const [rangeStart, rangeEnd] = [service.time.range[0], service.time.range[1]]
  const earliestStart = service.start.startOf('day').add(rangeStart, 'second')
  const latestEnd = service.start.startOf('day').add(rangeEnd, 'second')
  const preferredTime = service.time.preferred
    ? parseTime(service.time.preferred)
    : rangeStart
  const startTime = dayjs.max(
    earliestStart,
    service.start.startOf('day').add(preferredTime, 'second'),
  )
  const endTime = startTime.add(service.time.duration, 'minute')

  if (endTime.isAfter(latestEnd)) {
    console.log(
      `Warning: Enforced service ${service.id} cannot be scheduled within its time range. Skipping enforcement.`,
    )
    return false
  }

  // Check for conflicts
  const conflict = techSchedules[techId].find(
    existingService =>
      startTime.isBefore(ensureDayjs(existingService.end)) &&
      endTime.isAfter(ensureDayjs(existingService.start)),
  )

  if (conflict) {
    console.log(
      `Warning: Conflict detected for enforced service ${service.id} with tech ${techId}. Skipping enforcement.`,
    )
    return false
  }

  techSchedules[techId].push({
    ...service,
    start: startTime.toDate(),
    end: endTime.toDate(),
  })

  const serviceDate = startTime.format('YYYY-MM-DD')
  const serviceKey = `${service.id}-${serviceDate}`
  scheduledServiceIdsByDate.set(serviceKey, techId)

  return true
}

function compactSchedule(schedule) {
  const compactedSchedule = []
  let currentShift = []
  let shiftStart = null

  schedule.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  for (let i = 0; i < schedule.length; i++) {
    const service = schedule[i]
    const serviceStart = dayjs(service.start)
    const serviceEnd = dayjs(service.end)

    if (!shiftStart) {
      shiftStart = serviceStart
      currentShift.push(service)
    } else if (serviceStart.diff(shiftStart, 'minute') <= MAX_SHIFT_DURATION) {
      currentShift.push(service)
    } else {
      compactedSchedule.push(...compactShift(currentShift))
      currentShift = [service]
      shiftStart = serviceStart
    }
  }

  if (currentShift.length > 0) {
    compactedSchedule.push(...compactShift(currentShift))
  }

  return compactedSchedule
}

function compactShift(shift) {
  if (shift.length === 0) return []

  const compactedShift = []
  let currentTime = dayjs(shift[0].start)

  for (const service of shift) {
    const serviceStart = ensureDayjs(service.start)
    const serviceEnd = ensureDayjs(service.end)
    const serviceDuration = service.time.duration
    const [rangeStart, rangeEnd] = [
      service.time.range[0],
      service.time.range[1],
    ]
    const earliestStart = serviceStart.startOf('day').add(rangeStart, 'second')
    const latestEnd = serviceStart.startOf('day').add(rangeEnd, 'second')

    const newStart = dayjs.max(currentTime, earliestStart)
    const newEnd = dayjs.min(newStart.add(serviceDuration, 'minute'), latestEnd)

    if (
      newEnd.diff(newStart, 'minute') === serviceDuration &&
      newEnd.diff(currentTime, 'minute') <= MAX_SHIFT_DURATION
    ) {
      compactedShift.push({
        ...service,
        start: newStart.toDate(),
        end: newEnd.toDate(),
      })
      currentTime = newEnd
    } else {
      break
    }
  }

  return compactedShift
}

function printSummary(techSchedules, unscheduledServices) {
  let scheduleSummary = 'Schedule Summary:\n\n'

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    let techSummary = `${techId}:\n`

    // Sort all services by start time
    schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

    // Group services into shifts
    const shifts = []
    let currentShift = []

    schedule.forEach((service, index) => {
      if (index === 0 || areServicesInSameShift(schedule[index - 1], service)) {
        currentShift.push(service)
      } else {
        shifts.push(currentShift)
        currentShift = [service]
      }
    })

    if (currentShift.length > 0) {
      shifts.push(currentShift)
    }

    // Print services and calculate shift duration for each shift
    shifts.forEach((shift, shiftIndex) => {
      const shiftStart = ensureDayjs(shift[0].start)
      const actualShiftEnd = ensureDayjs(shift[shift.length - 1].end)
      const potentialShiftEnd = shiftStart.add(8, 'hours')

      const formatShiftTime = time => {
        return `${time.format('M/D')} ${time.format('ha').toLowerCase()}`
      }

      const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(actualShiftEnd)}, or as late as ${formatShiftTime(potentialShiftEnd)}`

      techSummary += `Shift ${shiftIndex + 1} (${shiftTimeRange}):\n`

      shift.forEach(service => {
        const date = ensureDayjs(service.start).format('M/D')
        const start = ensureDayjs(service.start).format('h:mma')
        const end = ensureDayjs(service.end).format('h:mma')
        techSummary += `- ${date}, ${start}-${end}, ${service.company} (time range: ${formatTimeRange(service.time.range[0], service.time.range[1])}) (id: ${service.id.split('-')[0]})\n`
      })

      const actualShiftDuration = actualShiftEnd
        .diff(shiftStart, 'hours', true)
        .toFixed(2)
      techSummary += `Actual shift duration: ${actualShiftDuration} hours (potential: 8.00 hours)\n\n`
    })

    if (schedule.length > 0) {
      scheduleSummary += techSummary
    }
  })

  // Unassigned services
  if (unscheduledServices.length > 0) {
    scheduleSummary += 'Unassigned services:\n'
    unscheduledServices.forEach(service => {
      const date = ensureDayjs(service.start).format('M/D')
      const timeWindow = formatTimeRange(
        service.time.range[0],
        service.time.range[1],
      )
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

function areServicesInSameShift(service1, service2) {
  const timeBetween = ensureDayjs(service2.start).diff(
    ensureDayjs(service1.end),
    'minute',
  )
  return timeBetween <= MAX_GAP_BETWEEN_SERVICES
}
