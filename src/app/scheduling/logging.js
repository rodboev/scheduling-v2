// /src/app/scheduling/logging.js
import {
  formatDate,
  formatTime,
  calculateDuration,
} from '../utils/dateHelpers.js'
import { findGaps, canFitInGap } from '../utils/gaps.js'

const SHOW_ONLY_TECH_1_SHIFT_1 = 0 // Toggle to show only Tech 1 Shift 1 when set to 1

export function printSummary({ techSchedules, unassignedServices }) {
  console.log('Schedule Summary:\n')

  const techSummaries = []
  let totalHours = 0
  let techCount = 0

  for (const [techId, schedule] of Object.entries(techSchedules)) {
    if (
      SHOW_ONLY_TECH_1_SHIFT_1 &&
      (techIndex !== 0 || !schedule.shifts || schedule.shifts.length === 0)
    ) {
      continue
    }

    if (schedule.shifts && schedule.shifts.length > 0) {
      console.log(`${techId}:`)
      techCount++

      let techTotalHours = 0

      for (const [shiftIndex, shift] of schedule.shifts.entries()) {
        if (SHOW_ONLY_TECH_1_SHIFT_1 && shiftIndex !== 0) {
          continue
        }

        const shiftStart = new Date(shift.shiftStart)
        const shiftEnd = new Date(shift.shiftEnd)

        const formatShiftTime = time => {
          return `${formatDate(time)} ${formatTime(time)}`
        }

        const shiftTimeRange = `${formatShiftTime(shiftStart)} - ${formatShiftTime(shiftEnd)}`

        console.log(`Shift ${shiftIndex + 1} (${shiftTimeRange}):`)

        if (Array.isArray(shift.services) && shift.services.length > 0) {
          const sortedServices = [...shift.services].sort(
            (a, b) => a.index - b.index,
          )

          for (const service of sortedServices) {
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
                : ''

            const distance = service?.distanceFromPrevious?.toFixed(2)
            const distanceStr = distance
              ? `(${distance}mi from ${service.previousCompany})`
              : ''

            const lat = service.location.latitude.toFixed(2)
            const long = service.location.longitude.toFixed(2)

            const shiftDate = formatDate(shiftStart)
            const serviceDate = date !== shiftDate ? `${date}, ` : ''

            console.log(
              `${service.index ? `[${service.index}] ` : ''}${serviceDate}${start}-${end}, ${service.company} (${lat}, ${long}) (range: ${timeRange}) ${distanceStr}`.trim(),
            )
          }

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

        const gaps = findGaps({
          shift,
          from: shiftStart,
          to: shiftEnd,
          minimumGap: 15,
        })

        if (gaps.length > 0) {
          console.log('Gaps in this shift:')
          for (const [index, gap] of gaps.entries()) {
            const gapStart = formatShiftTime(gap.start)
            const gapEnd = formatShiftTime(gap.end)
            console.log(
              `  Gap ${index + 1}: ${gapStart} - ${gapEnd} (${formatHours(gap.duration)} hours)`,
            )
          }
        } else {
          console.log('No gaps found in this shift.')
        }

        console.log('')
      }

      techSummaries.push(techTotalHours)
      totalHours += techTotalHours
    }
  }

  if (!SHOW_ONLY_TECH_1_SHIFT_1) {
    if (unassignedServices.length > 0) {
      console.log('Unassigned services:')
      for (const service of unassignedServices) {
        const serviceDate = new Date(service.date)
        const timeRange =
          service.time.range[0] && service.time.range[1]
            ? [
                formatTime(new Date(service.time.range[0])),
                formatTime(new Date(service.time.range[1])),
              ].join(' - ')
            : 'ANY'

        const preferredTime = service.time.preferred
          ? formatTime(new Date(service.time.preferred))
          : 'none'

        const lat = service.location.latitude.toFixed(2)
        const long = service.location.longitude.toFixed(2)
        const date = formatDate(serviceDate)

        console.log(
          `${date}, ${timeRange}, ${service.company} (${lat}, ${long}) (preferred: ${preferredTime}) (id: ${service.id})`.trim(),
        )
      }
      console.log(`\nTotal unassigned services: ${unassignedServices.length}`)
      console.log('')
    }

    const averageHours = totalHours / techCount
    const formattedTechHours = techSummaries.map(formatHours).join(', ')
    console.log(
      `Total hours: ${formatHours(totalHours)} (between ${techCount} techs): ${formattedTechHours} (average ${formatHours(averageHours)} hrs/tech)`,
    )
  }
}

function formatHours(hours) {
  return Number.isInteger(hours) ? hours.toString() : hours.toFixed(2)
}
