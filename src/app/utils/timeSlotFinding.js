// /src/app/utils/timeSlotFinding.js

import { parseTime } from '@/app/utils/timeRange'

export function findBestTimeSlot(event, existingEvents, [rangeStart, rangeEnd]) {
  const duration = event.time.duration * 60 * 1000 // Convert to milliseconds
  const dayStart = event.start.setHours(0, 0, 0, 0)
  const preferredTime = dayStart + parseTime(event.time.preferred) * 1000

  let bestSlot = null
  let bestDistance = Infinity

  for (
    let slotStart = dayStart + rangeStart * 1000;
    slotStart <= dayStart + rangeEnd * 1000 - duration;
    slotStart += 60000 // Check every minute
  ) {
    const slotEnd = slotStart + duration
    if (
      existingEvents.every((existingEvent) => {
        const existingStart = existingEvent.start.getTime()
        const existingEnd = existingEvent.end.getTime()
        return slotEnd <= existingStart || slotStart >= existingEnd
      })
    ) {
      const distance = Math.abs(slotStart - preferredTime)
      if (distance < bestDistance) {
        bestSlot = { start: slotStart, end: slotEnd }
        bestDistance = distance
      }
    }
  }

  return bestSlot
}
