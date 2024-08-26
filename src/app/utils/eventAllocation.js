// /src/app/utils/eventAllocation.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export function allocateEventsToResources(events, enforceTechs) {
  const techResources = new Map()
  const genericResources = []
  let genericResourceCount = 0

  events.sort((a, b) => {
    if (a.tech.enforced && !b.tech.enforced) return -1
    if (!a.tech.enforced && b.tech.enforced) return 1
    if (a.time.enforced && !b.time.enforced) return -1
    if (!a.time.enforced && b.time.enforced) return 1
    return a.time.preferred - b.time.preferred
  })

  const allocatedEvents = []
  const unallocatedEvents = []
  const scheduleSummary = {}

  for (const event of events) {
    let allocated = false

    if (enforceTechs || event.tech.enforced) {
      // Use the specific tech
      const techId = event.tech.code
      if (!techResources.has(techId)) {
        techResources.set(techId, { id: techId, title: event.tech.code })
      }
      if (
        canAllocateToResource(
          event,
          allocatedEvents.filter((e) => e.resourceId === techId),
        )
      ) {
        const allocatedEvent = createAllocatedEvent(event, techId, allocatedEvents)
        allocatedEvents.push(allocatedEvent)
        allocated = true
        addToScheduleSummary(scheduleSummary, allocatedEvent)
      } else {
        unallocatedEvents.push({ event, reason: 'Enforced tech, but time slot unavailable' })
      }
    } else {
      // For non-enforced techs, try generic resources
      for (let i = 0; i < genericResourceCount + 1; i++) {
        const resourceId = `Tech ${i + 1}`
        if (
          canAllocateToResource(
            event,
            allocatedEvents.filter((e) => e.resourceId === resourceId),
          )
        ) {
          if (i === genericResourceCount) {
            genericResources.push({ id: resourceId, title: resourceId })
            genericResourceCount++
          }
          const allocatedEvent = createAllocatedEvent(event, resourceId, allocatedEvents)
          allocatedEvents.push(allocatedEvent)
          allocated = true
          addToScheduleSummary(scheduleSummary, allocatedEvent)
          break
        }
      }
      if (!allocated) {
        unallocatedEvents.push({ event, reason: 'No available time slot found for any resource' })
      }
    }
  }

  console.log('Allocated events:', allocatedEvents.length)
  console.log('Unallocated events:', unallocatedEvents.length)
  unallocatedEvents.forEach(({ event, reason }) => {
    console.warn(`Could not allocate event: ${event.title}. Reason: ${reason}`)
  })

  const resources = [...techResources.values(), ...genericResources]
  return { allocatedEvents, resources, unallocatedEvents, scheduleSummary }
}

function addToScheduleSummary(scheduleSummary, event) {
  const resourceName = event.resourceId
  const startTime = dayjs(event.start).format('h:mma')
  const endTime = dayjs(event.end).format('h:mma')

  if (!scheduleSummary[resourceName]) {
    scheduleSummary[resourceName] = []
  }

  scheduleSummary[resourceName].push(`${event.title} is at ${startTime}-${endTime}`)
}

function createAllocatedEvent(event, resourceId, existingEvents) {
  const allocatedEvent = {
    ...event,
    resourceId: resourceId,
  }

  if (!event.time.enforced) {
    // For non-enforced times, find the best slot within the range
    const bestSlot = findBestTimeSlot(
      event,
      existingEvents.filter((e) => e.resourceId === resourceId),
    )
    allocatedEvent.start = new Date(bestSlot.start)
    allocatedEvent.end = new Date(bestSlot.end)
  }

  return allocatedEvent
}

function canAllocateToResource(newEvent, existingEvents) {
  if (newEvent.time.enforced) {
    // For enforced times, check for direct conflicts
    const newStart = newEvent.start.getTime()
    const newEnd = newEvent.end.getTime()
    return existingEvents.every((existingEvent) => {
      const existingStart = existingEvent.start.getTime()
      const existingEnd = existingEvent.end.getTime()
      return newEnd <= existingStart || newStart >= existingEnd
    })
  } else {
    // For non-enforced times, check if there's any available slot within the range
    const [rangeStart, rangeEnd] = newEvent.time.range
    const duration = newEvent.time.duration * 60 * 1000 // Convert to milliseconds
    const dayStart = newEvent.start.setHours(0, 0, 0, 0)

    for (
      let slotStart = dayStart + rangeStart * 1000;
      slotStart <= dayStart + rangeEnd * 1000 - duration;
      slotStart += 60000
    ) {
      const slotEnd = slotStart + duration
      if (
        existingEvents.every((existingEvent) => {
          const existingStart = existingEvent.start.getTime()
          const existingEnd = existingEvent.end.getTime()
          return slotEnd <= existingStart || slotStart >= existingEnd
        })
      ) {
        return true
      }
    }
    return false
  }
}

function findBestTimeSlot(event, existingEvents) {
  const [rangeStart, rangeEnd] = event.time.range
  const duration = event.time.duration * 60 * 1000 // Convert to milliseconds
  const dayStart = event.start.setHours(0, 0, 0, 0)
  const preferredTime = dayStart + event.time.preferred * 1000

  let bestSlot = null
  let bestDistance = Infinity

  for (
    let slotStart = dayStart + rangeStart * 1000;
    slotStart <= dayStart + rangeEnd * 1000 - duration;
    slotStart += 60000
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
