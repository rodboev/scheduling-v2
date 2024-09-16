import { dayjsInstance as dayjs, ensureDayjs } from '@/app/utils/dayjs'

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
        const shiftStart = ensureDayjs(shift.shiftStart)
        const shiftEnd = ensureDayjs(shift.shiftEnd)

        const formatShiftTime = time => {
          return `${time.format('M/D')} ${time.format('h:mma').toLowerCase()}`
        }

        const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(shiftEnd)}`

        console.log(`Shift ${shiftIndex + 1} (${shiftTimeRange}):`)

        if (Array.isArray(shift.services) && shift.services.length > 0) {
          shift.services.forEach(service => {
            const startTime = ensureDayjs(service.start)
            const endTime = ensureDayjs(service.end)
            const date = startTime.format('M/D')
            const start = startTime.format('h:mma')
            const end = endTime.format('h:mma')
            const timeRange =
              service.time.range[0] && service.time.range[1]
                ? [
                    ensureDayjs(service.time.range[0]).format('h:mma'),
                    ensureDayjs(service.time.range[1]).format('h:mma'),
                  ].join(' - ')
                : 'Invalid'
            console.log(
              `- ${date}, ${start}-${end}, ${service.company} (time range: ${timeRange}) (id: ${service.id.split('-')[0]})`,
            )
          })

          const firstServiceStart = ensureDayjs(shift.services[0].start)
          const lastServiceEnd = ensureDayjs(
            shift.services[shift.services.length - 1].end,
          )
          const shiftDuration = lastServiceEnd.diff(
            firstServiceStart,
            'hours',
            true,
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
            const gapDuration = gap.end.diff(gap.start, 'hours', true)
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

  // Unassigned services
  if (unassignedServices.length > 0) {
    console.log('Unassigned services:')
    unassignedServices.forEach(service => {
      const date = ensureDayjs(service.date).format('M/D')
      const timeRange =
        service.time.range[0] && service.time.range[1]
          ? [
              ensureDayjs(service.time.range[0]).format('h:mma'),
              ensureDayjs(service.time.range[1]).format('h:mma'),
            ].join(' - ')
          : 'Invalid'
      console.log(
        `- ${date}, ${timeRange} time range, ${service.company} (id: ${service.id})`,
      )
    })
    console.log('')
  }

  // Print total hours summary
  const averageHours = totalHours / techCount
  const formattedTechHours = techSummaries.map(formatHours).join(', ')
  console.log(
    `Total hours (between ${techCount} techs): ${formattedTechHours} (average ${formatHours(averageHours)} hrs/tech)`,
  )
}

// Helper function to format hours
function formatHours(hours) {
  return Number.isInteger(hours) ? hours.toString() : hours.toFixed(2)
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
