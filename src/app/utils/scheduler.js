import { dayjsInstance as dayjs } from './dayjs'
import { parseTime, parseTimeRange, formatTimeRange } from './timeRange'

const MAX_SHIFT_HOURS = 8
const MIN_REST_HOURS = 16 // 16 hours minimum rest between shifts
const MAX_SHIFT_GAP = MIN_REST_HOURS

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

  const scheduledServiceIdsByDate = new Map()

  let unscheduledServices = services
    .filter(
      service =>
        service.time.range[0] === null || service.time.range[1] === null,
    )
    .map(service => ({
      ...service,
      reason: 'Invalid time range',
    }))

  let servicesToSchedule = services.filter(
    service => service.time.range[0] !== null && service.time.range[1] !== null,
  )

  // Ensure visibleStart and visibleEnd are dayjs objects
  visibleStart = ensureDayjs(visibleStart)
  visibleEnd = ensureDayjs(visibleEnd)

  // Convert all date fields in services to dayjs objects
  servicesToSchedule = servicesToSchedule.map(service => ({
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
  servicesToSchedule.sort((a, b) => {
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

  const techSchedules = {
    // techId: {
    //   shifts: [
    //     {
    //       shiftStart: dayjs,
    //       shiftEnd: dayjs,
    //       services: []
    //     }
    //   ]
    // }
  }
  let nextGenericTechId = 1

  const totalServices = servicesToSchedule.length

  for (const [serviceIndex, service] of servicesToSchedule.entries()) {
    let scheduled = false

    if (service.tech.enforced && service.tech.code) {
      scheduled = scheduleEnforcedService(
        service,
        techSchedules,
        scheduledServiceIdsByDate,
      )
    } else {
      // Main scheduling loop for non-enforced services
      scheduled = scheduleService({
        service,
        techSchedules,
        scheduledServiceIdsByDate,
        nextGenericTechId,
        remainingServices: servicesToSchedule.slice(serviceIndex + 1),
      })
      // If we scheduled the service, increment the next generic tech id
      if (scheduled) {
        nextGenericTechId =
          Math.max(
            ...Object.keys(techSchedules).map(id => parseInt(id.split(' ')[1])),
          ) + 1
      } else {
        unscheduledServices.push(service)
      }
    }

    const progress = Math.round((serviceIndex / totalServices) * 100)
    onProgress(progress)

    if (serviceIndex % 10 === 0) {
      await delay(0)
    }
  }

  console.timeEnd('Total scheduling time')

  printSummary({ techSchedules, unscheduledServices })

  // Convert techSchedules to flat scheduledServices array with start and end dates
  const scheduledServices = Object.entries(techSchedules).flatMap(
    ([techId, schedule]) =>
      schedule.shifts.flatMap(shift =>
        shift.services.map(service => ({
          ...service,
          start: new Date(service.start),
          end: new Date(service.end),
          resourceId: techId,
        })),
      ),
  )

  console.timeEnd('Total time')

  return {
    scheduledServices,
    unscheduledServices,
    techSchedules,
  }
}

function scheduleService({
  service,
  techSchedules,
  scheduledServiceIdsByDate,
  nextGenericTechId,
  remainingServices,
}) {
  // IN PROGRESS: Try to schedule on all existing techs, create shift only if service in question can fit in it
  // Are we iterating more than once to the next, next, next, etc. tech?

  // Try to schedule on all existing techs without creating new shifts
  for (const techId in techSchedules) {
    const result = scheduleServiceForTech({
      service,
      techId,
      techSchedules,
      scheduledServiceIdsByDate,
      allowNewShift: false,
      remainingServices,
    })

    if (result.scheduled) {
      return result
    }
  }

  // IN PROGRESS: If cannot schedule the service in the existing tech, including in the new shift created:
  // - Create a new tech if does not exist
  // - Schedule the service on the new tech, on a shift starting at the range start

  // If not scheduled, try again on all techs, this time allowing new shifts
  for (const techId in techSchedules) {
    const result = scheduleServiceForTech({
      service,
      techId,
      techSchedules,
      scheduledServiceIdsByDate,
      allowNewShift: true,
      remainingServices,
    })

    if (result.scheduled) {
      return result
    }
  }

  // If still not scheduled, create a new tech and try to schedule
  const newTechId = `Tech ${nextGenericTechId}`
  techSchedules[newTechId] = { shifts: [] }
  return scheduleServiceForTech({
    service,
    techId: newTechId,
    techSchedules,
    scheduledServiceIdsByDate,
    allowNewShift: true,
    remainingServices,
  })
}

function scheduleServiceForTech({
  service,
  techId,
  techSchedules,
  scheduledServiceIdsByDate,
  allowNewShift,
  remainingServices,
}) {
  const techSchedule = techSchedules[techId]
  const [rangeStart, rangeEnd] = service.time.range.map(ensureDayjs)
  const serviceDuration = service.time.duration

  // Try to fit the service into an existing shift
  for (let shift of techSchedule.shifts) {
    if (tryScheduleInShift(service, shift, scheduledServiceIdsByDate, techId)) {
      // console.log(
      //   `${techId}: Scheduled ${service.company} at ${ensureDayjs(service.start).format('h:mma')}`,
      // )
      return {
        scheduled: true,
        reason: `Scheduled in existing shift for Tech ${techId}`,
      }
    }
  }

  // If allowed and necessary (we couldn't fit the service in any existing shift), try to create a new shift
  if (allowNewShift) {
    const lastShift = techSchedule.shifts[techSchedule.shifts.length - 1]
    let newShiftStart = ensureDayjs(rangeStart)
    // console.log(
    //   `[NEW SHIFT] ${techId}: ${newShiftStart.format('M/D')} (${newShiftStart.format('h:mma')} - ${newShiftStart.add(MAX_SHIFT_HOURS, 'hours').format('h:mma')})`,
    // )
    if (lastShift) {
      const minStartTime = ensureDayjs(lastShift.shiftEnd).add(
        MIN_REST_HOURS,
        'hour',
      )
      const preferredStartTime = ensureDayjs(lastShift.shiftEnd).add(16, 'hour')

      // Look for services within the preferred 16-hour window
      const servicesWithinWindow = remainingServices.filter(s =>
        ensureDayjs(s.time.range[0]).isBetween(
          minStartTime,
          preferredStartTime,
          null,
          '[]',
        ),
      )

      if (servicesWithinWindow.length > 0) {
        // If there are services within the window, start the shift at the earliest service
        newShiftStart = dayjs.min(
          servicesWithinWindow.map(s => ensureDayjs(s.time.range[0])),
        )
      } else {
        // If no services within the window, use the current service start time, but cap the gap
        newShiftStart = dayjs.min([
          dayjs.max([newShiftStart, minStartTime]),
          ensureDayjs(lastShift.shiftEnd).add(MAX_SHIFT_GAP, 'hours'),
        ])
      }
    }

    // Create a new shift object with an 8-hour duration
    const newShift = {
      shiftStart: newShiftStart,
      shiftEnd: newShiftStart.add(MAX_SHIFT_HOURS, 'hours'),
      services: [],
    }

    // Attempt to schedule the service in the new shift, on the same tech
    if (
      tryScheduleInShift(service, newShift, scheduledServiceIdsByDate, techId)
    ) {
      techSchedule.shifts.push(newShift)
      return {
        scheduled: true,
        reason: `Scheduled in new shift for Tech ${techId}`,
      }
    }
  }

  return {
    scheduled: false,
    reason: `No time in any shift for Tech ${techId}`,
  }
}

function tryScheduleInShift(service, shift, scheduledServiceIdsByDate, techId) {
  // TODO: Try to increment the service start time by 15 minutes until we find a time that works
  const [rangeStart, rangeEnd] = service.time.range
  const serviceDuration = service.time.duration
  const shiftStart = ensureDayjs(shift.shiftStart)
  const shiftEnd = ensureDayjs(shift.shiftEnd)

  // Ensure the service starts no earlier than its range start and the shift start
  let startTime = dayjs.max(shiftStart, rangeStart)
  const latestPossibleStart = dayjs
    .min(shiftEnd, rangeEnd)
    .subtract(serviceDuration, 'minute')

  while (startTime.isSameOrBefore(latestPossibleStart)) {
    let endTime = startTime.add(serviceDuration, 'minute')
    let canSchedule = true

    // Check if this time slot conflicts with any existing services
    for (const existingService of shift.services) {
      const existingStart = ensureDayjs(existingService.start)
      const existingEnd = ensureDayjs(existingService.end)

      if (
        (startTime.isSameOrAfter(existingStart) &&
          startTime.isBefore(existingEnd)) ||
        (endTime.isAfter(existingStart) &&
          endTime.isSameOrBefore(existingEnd)) ||
        (startTime.isBefore(existingStart) && endTime.isAfter(existingEnd))
      ) {
        canSchedule = false
        break
      }
    }

    if (canSchedule) {
      // We found a suitable time slot, schedule the service
      const scheduledService = {
        ...service,
        start: startTime.toDate(),
        end: endTime.toDate(),
      }

      shift.services.push(scheduledService)
      shift.services.sort((a, b) =>
        ensureDayjs(a.start).diff(ensureDayjs(b.start)),
      )

      const serviceDate = startTime.format('YYYY-MM-DD')
      const serviceKey = `${service.id}-${serviceDate}`
      scheduledServiceIdsByDate.set(serviceKey, techId)

      return true
    }

    // If we can't schedule at this time, try 15 minutes later
    startTime = startTime.add(15, 'minute')
  }

  // If we've tried all possible start times and couldn't schedule, return false
  return false
}

function scheduleEnforcedService(
  service,
  techSchedules,
  scheduledServiceIdsByDate,
) {
  const techId = service.tech.code
  if (!techSchedules[techId]) {
    techSchedules[techId] = { shifts: [] }
  }

  const [rangeStart, rangeEnd] = service.time.range // rangeStart and rangeEnd may be null
  const serviceDuration = service.time.duration
  const preferredTime = service.time.preferred

  // Ensure the service starts no earlier than its range start and preferred time
  // const startTime = dayjs.max(rangeStart, preferredTime)
  const startTime = preferredTime
  const endTime = startTime.add(serviceDuration, 'minute')

  // Ensure the service ends no later than its range end
  // if (endTime.isAfter(rangeEnd)) {
  //   return false
  // }

  // Find or create an appropriate shift
  let targetShift
  for (let shift of techSchedules[techId].shifts) {
    if (
      startTime.isSameOrAfter(shift.shiftStart) &&
      endTime.isSameOrBefore(shift.shiftEnd)
    ) {
      targetShift = shift
      break
    }
  }

  if (!targetShift) {
    targetShift = {
      shiftStart: startTime,
      shiftEnd: startTime.add(8, 'hours'),
      services: [],
    }
    techSchedules[techId].shifts.push(targetShift)
  }

  // Schedule the service
  const scheduledService = {
    ...service,
    start: startTime.toDate(),
    end: endTime.toDate(),
  }
  targetShift.services.push(scheduledService)
  targetShift.services.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  const serviceDate = startTime.format('YYYY-MM-DD')
  const serviceKey = `${service.id}-${serviceDate}`
  scheduledServiceIdsByDate.set(serviceKey, techId)

  return {
    scheduled: true,
  }
}

function printSummary({ techSchedules, unscheduledServices }) {
  let scheduleSummary = 'Schedule Summary:\n\n'

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    let techSummary = `${techId}:\n`

    if (Array.isArray(schedule.shifts)) {
      schedule.shifts.forEach((shift, shiftIndex) => {
        const shiftStart = ensureDayjs(shift.shiftStart)
        const shiftEnd = ensureDayjs(shift.shiftEnd)

        const formatShiftTime = time => {
          return `${time.format('M/D')} ${time.format('h:mma').toLowerCase()}`
        }

        const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(shiftEnd)}`

        techSummary += `Shift ${shiftIndex + 1} (${shiftTimeRange}):\n`

        if (Array.isArray(shift.services)) {
          shift.services.forEach(service => {
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
        }

        const shiftDuration = shiftEnd
          .diff(shiftStart, 'hours', true)
          .toFixed(2)
        techSummary += `Shift duration: ${shiftDuration} hours\n`

        // Find and print gaps
        const gaps = findScheduleGaps(shift, shiftStart, shiftEnd)
        if (gaps.length > 0) {
          techSummary += 'Gaps in this shift:\n'
          gaps.forEach((gap, index) => {
            const gapStart = formatShiftTime(gap.start)
            const gapEnd = formatShiftTime(gap.end)
            const gapDuration = gap.end
              .diff(gap.start, 'hours', true)
              .toFixed(2)
            techSummary += `  Gap ${index + 1}: ${gapStart} - ${gapEnd} (${gapDuration} hours)\n`
          })
        } else {
          techSummary += 'No gaps found in this shift.\n'
        }

        techSummary += '\n'
      })
    }

    if (schedule.shifts && schedule.shifts.length > 0) {
      scheduleSummary += techSummary
    }
  })

  // Unassigned services
  if (unscheduledServices.length > 0) {
    scheduleSummary += 'Unassigned services:\n'
    unscheduledServices.forEach(service => {
      const date = ensureDayjs(service.date).format('M/D')
      const timeRange =
        service.time.range[0] && service.time.range[0]
          ? [
              ensureDayjs(service.time.range[0]).format('h:mma'),
              ensureDayjs(service.time.range[1]).format('h:mma'),
            ].join(' - ')
          : 'Invalid'
      scheduleSummary += `- ${date}, ${timeRange} time range, ${service.company} (id: ${service.id})\n`
    })
  }

  console.log(scheduleSummary)
}

function findScheduleGaps(shift, from, to) {
  const gaps = []
  let currentTime = ensureDayjs(from)
  const endTime = ensureDayjs(to)

  shift.services.sort((a, b) => dayjs(a.start).diff(dayjs(b.start)))

  for (const service of shift.services) {
    const serviceStart = ensureDayjs(service.start)
    const serviceEnd = ensureDayjs(service.end)

    if (serviceStart.isAfter(currentTime)) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
      })
    }

    currentTime = serviceEnd.isAfter(currentTime) ? serviceEnd : currentTime
  }

  if (endTime.isAfter(currentTime)) {
    gaps.push({
      start: currentTime,
      end: endTime,
    })
  }

  return gaps
}
