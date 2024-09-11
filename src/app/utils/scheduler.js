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
    time: {
      ...service.time,
      range: service.time.range.map(ensureDayjs),
      preferred: ensureDayjs(service.time.preferred),
    },
    date: ensureDayjs(service.date),
  }))

  // Sort services by date, then by time window size (ascending) and duration (descending)
  console.time('Sorting services')
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
    } else {
      // Try to schedule with existing techs
      for (const techId in techSchedules) {
        // First pass: Try to schedule with respect to work hours
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

        // Second pass: Try to fill gaps for this tech
        // if (!scheduled) {
        //   const schedule = techSchedules[techId]
        //   const shifts = findShifts(schedule)

        //   for (const shift of shifts) {
        //     const shiftStart = ensureDayjs(shift[0].start)
        //     const potentialShiftEnd = shiftStart.add(8, 'hours')
        //     const gaps = findScheduleGaps(shift, shiftStart, potentialShiftEnd)

        //     for (const gap of gaps) {
        //       if (
        //         tryScheduleServiceInGap(
        //           service,
        //           gap,
        //           techId,
        //           techSchedules,
        //           scheduledServiceIdsByDate,
        //         )
        //       ) {
        //         scheduled = true
        //         break
        //       }
        //     }
        //     if (scheduled) break
        //   }
        // }

        if (scheduled) break
      }

      // If not scheduled, create a new tech
      if (!scheduled) {
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

function findShifts(schedule) {
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

  return shifts
}

function tryScheduleServiceInGap(
  service,
  gap,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  // Date objects:
  const [rangeStart, rangeEnd] = service.time.range
  const serviceDate = rangeStart.startOf('day')
  const earliestPossibleStart = rangeStart
  const latestPossibleEnd = rangeEnd
  const preferredTime = service.time.preferred

  // dayjs objects:
  const gapStart = ensureDayjs(gap.start)
  const gapEnd = ensureDayjs(gap.end)

  if (gapEnd.diff(gapStart, 'minute') >= service.time.duration) {
    let startTime = dayjs.max(gapStart, earliestPossibleStart, preferredTime)
    if (startTime.add(service.time.duration, 'minute').isAfter(gapEnd)) {
      startTime = gapEnd.subtract(service.time.duration, 'minute')
    }
    const endTime = startTime.add(service.time.duration, 'minute')

    if (
      startTime.isSameOrAfter(gapStart) &&
      endTime.isSameOrBefore(gapEnd) &&
      startTime.isSameOrAfter(earliestPossibleStart) &&
      endTime.isSameOrBefore(latestPossibleEnd)
    ) {
      const scheduledService = {
        ...service,
        start: startTime.toDate(),
        end: endTime.toDate(),
      }
      techSchedules[techId].push(scheduledService)
      techSchedules[techId].sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

      const serviceDate = startTime.format('YYYY-MM-DD')
      const serviceKey = `${service.id}-${serviceDate}`
      scheduledServiceIdsByDate.set(serviceKey, techId)

      return true
    }
  }

  return false
}

function areServicesInSameShift(service1, service2) {
  const timeBetween = ensureDayjs(service2.start).diff(
    ensureDayjs(service1.end),
    'minute',
  )
  return timeBetween <= MAX_GAP_BETWEEN_SERVICES
}

function scheduleServiceWithRespectToWorkHours(
  service,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  if (
    service.time.meta.originalRange.includes('null') ||
    service.time.meta.originalRange.length === 0
  ) {
    return { scheduled: false, reason: 'Improper time range' }
  }

  // Date objects:
  const [rangeStart, rangeEnd] = service.time.range
  const earliestStart = rangeStart
  const latestEnd = rangeEnd
  const preferredTime = service.time.preferred

  if (!techSchedules[techId]) {
    techSchedules[techId] = []
  }

  const schedule = techSchedules[techId].map(s => ({
    ...s,
    start: ensureDayjs(s.start),
    end: ensureDayjs(s.end),
  }))

  const gaps = findScheduleGaps(schedule, earliestStart, latestEnd)
  console.log('Returned from findScheduleGaps')
  console.log(
    'Schedule:',
    schedule.map(service => service.company),
  )
  console.log(
    'Gap:',
    gaps.map(gap => ({
      start: gap.start.format('M/D h:mma'),
      end: gap.end.format('M/D h:mma'),
    })),
  )
  debugger

  for (const gap of gaps) {
    const gapStart = dayjs.max(gap.start, earliestStart)
    const gapEnd = dayjs.min(gap.end, latestEnd)
    const preferredStart = dayjs.max(gapStart, preferredTime)

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

function findScheduleGaps(schedule, from, to) {
  const gaps = []
  let currentTime = ensureDayjs(from)
  const endTime = ensureDayjs(to)

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

  if (!techSchedules[techId]) techSchedules[techId] = []

  const startTime = service.time.preferred
  const endTime = startTime.add(service.time.duration, 'minute')

  techSchedules[techId].push({
    ...service,
    start: startTime.toDate(),
    end: endTime.toDate(),
  })

  const serviceDate = startTime.format('YYYY-MM-DD')
  const serviceKey = `${service.id.split('-')[0]}-${serviceDate}`
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
    // Date objects:
    const [rangeStart, rangeEnd] = service.time.range
    const earliestStart = rangeStart
    const latestEnd = rangeEnd

    // dayjs objects:
    const newStart = dayjs.max(currentTime, earliestStart)
    const newEnd = dayjs.min(newStart.add(serviceDuration, 'minute'), latestEnd)

    const serviceDuration = service.time.duration
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
    // schedule.sort((a, b) => ensureDayjs(a.start).diff(ensureDayjs(b.start)))

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

    // Print services, calculate shift duration, and find gaps for each shift
    shifts.forEach((shift, shiftIndex) => {
      const shiftStart = ensureDayjs(shift[0].start)
      const actualShiftEnd = ensureDayjs(shift[shift.length - 1].end)
      const potentialShiftEnd = shiftStart.add(8, 'hours')

      const formatShiftTime = time => {
        return `${time.format('M/D')} ${time.format('h:mma').toLowerCase()}`
      }

      const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(actualShiftEnd)}, or as late as ${formatShiftTime(potentialShiftEnd)}`

      techSummary += `Shift ${shiftIndex + 1} (${shiftTimeRange}):\n`

      shift.forEach(service => {
        const startTime = ensureDayjs(service.start)
        const endTime = ensureDayjs(service.end)
        const date = startTime.format('M/D')
        const start = startTime.format('h:mma')
        const end = endTime.format('h:mma')
        const timeRange = formatTimeRange(
          service.time.range[0],
          service.time.range[1],
        )
        techSummary += `- ${date}, ${start}-${end}, ${service.company} (time range: ${timeRange}) (id: ${service.id.split('-')[0]})\n`
      })

      const actualShiftDuration = actualShiftEnd
        .diff(shiftStart, 'hours', true)
        .toFixed(2)
      techSummary += `Shift duration: ${actualShiftDuration} hours\n`

      // Find and print gaps
      const gaps = findScheduleGaps(shift, shiftStart, potentialShiftEnd)
      if (gaps.length > 0) {
        techSummary += 'Gaps in this shift:\n'
        gaps.forEach((gap, index) => {
          const gapStart = formatShiftTime(gap.start)
          const gapEnd = formatShiftTime(gap.end)
          const gapDuration = gap.end.diff(gap.start, 'hours', true).toFixed(2)
          techSummary += `  Gap ${index + 1}: ${gapStart} - ${gapEnd} (${gapDuration} hours)\n`
        })
      } else {
        techSummary += 'No gaps found in this shift.\n'
      }

      techSummary += '\n'
    })

    if (schedule.length > 0) {
      scheduleSummary += techSummary
    }
  })

  // Unassigned services (unchanged)
  if (unscheduledServices.length > 0) {
    scheduleSummary += 'Unassigned services:\n'
    unscheduledServices.forEach(service => {
      const date = ensureDayjs(service.date).format('M/D')
      const timeRange = formatTimeRange(
        service.time.range[0],
        service.time.range[1],
      )
      scheduleSummary += `- ${date}, ${timeRange} time range, ${service.company} (id: ${service.id}), Reason: ${service.reason}\n`
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
