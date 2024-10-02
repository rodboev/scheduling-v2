// /src/app/scheduling/logging.js
import {
  formatDate,
  formatTime,
  calculateDuration,
} from '../utils/dateHelpers.js'

const SHOW_ONLY_TECH_1_SHIFT_1 = 0 // Toggle to show only Tech 1 Shift 1 when set to 1

export function printSummary({ techSchedules, unassignedServices }) {
  console.log('Schedule Summary:\n')

  let techSummaries = []
  let totalHours = 0
  let techCount = 0

  Object.entries(techSchedules).forEach(([techId, schedule], techIndex) => {
    if (
      SHOW_ONLY_TECH_1_SHIFT_1 &&
      (techIndex !== 0 || !schedule.shifts || schedule.shifts.length === 0)
    ) {
      return // Skip other techs when toggle is enabled
    }

    if (schedule.shifts && schedule.shifts.length > 0) {
      console.log(`${techId}:`)
      techCount++

      let techTotalHours = 0

      schedule.shifts.forEach((shift, shiftIndex) => {
        if (SHOW_ONLY_TECH_1_SHIFT_1 && shiftIndex !== 0) {
          return // Skip other shifts when toggle is enabled
        }

        const shiftStart = new Date(shift.shiftStart)
        const shiftEnd = new Date(shift.shiftEnd)

        const formatShiftTime = time => {
          return `${formatDate(time)} ${formatTime(time)}`
        }

        const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(shiftEnd)}`

        console.log(`Shift ${shiftIndex + 1} (${shiftTimeRange}):`)

        if (Array.isArray(shift.services) && shift.services.length > 0) {
          // Sort services by their assigned index to ensure correct order
          const sortedServices = [...shift.services].sort(
            (a, b) => a.index - b.index,
          )

          sortedServices.forEach((service, serviceIndex) => {
            const startTime = new Date(service.start)
            const endTime = new Date(service.end)
            const date = formatDate(startTime)
            const start = formatTime(startTime)
            const end = formatTime(endTime)
            const timeRange =
              service.time.range[0] && service.time.range[1]
                ? [
                    formatTime(new Date(service.time.range[0])),
                    formatTime(new Date(service.time.range[1])),
                  ].join(' - ')
                : 'Invalid'

            const distance = service?.distanceFromPrevious?.toFixed(2)
            const distanceStr = distance
              ? `(${distance} mi from ${service.previousCompany})`
              : `(distance missing)`

            console.log(
              `- [${service.index}] ${date}, ${start}-${end}, ${service.company} (${service.location.latitude}, ${service.location.longitude}) (range: ${timeRange}) ${distanceStr}`,
            )
          })

          const firstService = sortedServices[0]
          const lastService = sortedServices[sortedServices.length - 1]
          const shiftDuration = calculateDuration(
            new Date(firstService.start),
            new Date(lastService.end),
          )
          techTotalHours += shiftDuration
          console.log(`Shift duration: ${formatHours(shiftDuration)} hours`)
        } else {
          console.log('No services scheduled in this shift.')
        }

        // Find and print gaps
        const gaps = findScheduleGaps(shift, shiftStart, shiftEnd)
        if (gaps.length > 0) {
          console.log('Gaps in this shift:')
          gaps.forEach((gap, index) => {
            const gapStart = formatShiftTime(gap.start)
            const gapEnd = formatShiftTime(gap.end)
            const gapDuration = calculateDuration(gap.start, gap.end)
            console.log(
              `  Gap ${index + 1}: ${gapStart} - ${gapEnd} (${formatHours(gapDuration)} hours)`,
            )
          })
        } else {
          console.log('No gaps found in this shift.')
        }

        console.log('')
      })

      techSummaries.push(techTotalHours)
      totalHours += techTotalHours
    }
  })

  if (!SHOW_ONLY_TECH_1_SHIFT_1) {
    // Print unassigned services
    if (unassignedServices.length > 0) {
      console.log('Unassigned services:')
      unassignedServices.forEach(service => {
        const date = formatDate(new Date(service.date))
        const timeRange =
          service.time.range[0] && service.time.range[1]
            ? [
                formatTime(new Date(service.time.range[0])),
                formatTime(new Date(service.time.range[1])),
              ].join(' - ')
            : 'Invalid time range'
        console.log(
          `- ${date}, ${timeRange}, ${service.company} (id: ${service.id})`,
        )
      })
      console.log('')
    }

    // Print total hours summary
    const averageHours = totalHours / techCount
    const formattedTechHours = techSummaries.map(formatHours).join(', ')
    console.log(
      `Total hours: ${formatHours(totalHours)} (between ${techCount} techs): ${formattedTechHours} (average ${formatHours(averageHours)} hrs/tech)`,
    )
  }
}

// Helper function to format hours
function formatHours(hours) {
  return Number.isInteger(hours) ? hours.toString() : hours.toFixed(2)
}

// Placeholder for findScheduleGaps function
function findScheduleGaps(shift, shiftStart, shiftEnd) {
  const gaps = []
  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start) - new Date(b.start),
  )

  let previousEnd = shiftStart
  sortedServices.forEach(service => {
    const serviceStart = new Date(service.start)
    if (serviceStart > previousEnd) {
      gaps.push({ start: previousEnd, end: serviceStart })
    }
    const serviceEnd = new Date(service.end)
    if (serviceEnd > previousEnd) {
      previousEnd = serviceEnd
    }
  })

  if (previousEnd < shiftEnd) {
    gaps.push({ start: previousEnd, end: shiftEnd })
  }

  return gaps
}
