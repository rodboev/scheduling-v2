import {
  formatDate,
  formatTime,
  calculateDuration,
} from '../utils/dateHelpers.js'

export function printSummary({ techSchedules, unassignedServices }) {
  console.log('Schedule Summary:\n')

  let techSummaries = []
  let totalHours = 0
  let techCount = 0

  Object.entries(techSchedules).forEach(([techId, schedule]) => {
    if (schedule.shifts && schedule.shifts.length > 0) {
      console.log(`${techId}:`)
      techCount++

      let techTotalHours = 0

      schedule.shifts.forEach((shift, shiftIndex) => {
        const shiftStart = new Date(shift.shiftStart)
        const shiftEnd = new Date(shift.shiftEnd)

        const formatShiftTime = time => {
          return `${formatDate(time)} ${formatTime(time)}`
        }

        const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(shiftEnd)}`

        console.log(`Shift ${shiftIndex + 1} (${shiftTimeRange}):`)

        if (Array.isArray(shift.services) && shift.services.length > 0) {
          // Sort services chronologically
          const sortedServices = [...shift.services].sort(
            (a, b) => new Date(a.start) - new Date(b.start),
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
              `- ${date}, ${start}-${end}, ${service.company} (${service.location.latitude}, ${service.location.longitude}) (time range: ${timeRange}) ${distanceStr}`,
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

// Helper function to format hours
function formatHours(hours) {
  return Number.isInteger(hours) ? hours.toString() : hours.toFixed(2)
}

function findScheduleGaps(shift, from, to) {
  const gaps = []
  let currentTime = new Date(from)
  const endTime = new Date(to)

  const sortedServices = [...shift.services].sort(
    (a, b) => new Date(a.start) - new Date(b.start),
  )

  for (const service of sortedServices) {
    const serviceStart = new Date(service.start)
    const serviceEnd = new Date(service.end)

    if (serviceStart > currentTime) {
      gaps.push({
        start: currentTime,
        end: serviceStart,
      })
    }

    currentTime = serviceEnd > currentTime ? serviceEnd : currentTime
  }

  if (endTime > currentTime) {
    gaps.push({
      start: currentTime,
      end: endTime,
    })
  }

  return gaps
}
