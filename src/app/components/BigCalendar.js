// src/app/components/BigCalendar.js

'use client'

import React, { useMemo, useCallback, useState, useEffect } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTime, formatTimeRange, formatParsedTimeRange } from '@/app/utils/timeRange'

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const { data: serviceSetups, isLoading, error } = useServiceSetups()
  const [date, setDate] = useState(new Date(2024, 8, 2)) // September 2, 2024
  const [view, setView] = useState(Views.DAY)

  const { allocatedEvents, resources } = useMemo(() => {
    if (!serviceSetups) return { allocatedEvents: [], resources: [] }

    const rawEvents = serviceSetups.flatMap((setup) => {
      return generateEventsForYear(setup, 2024)
    })

    return allocateEventsToResources(rawEvents)
  }, [serviceSetups])

  const currentDateEvents = useMemo(() => {
    return allocatedEvents.filter((event) => dayjs(event.start).isSame(date, 'day'))
  }, [allocatedEvents, date])

  useEffect(() => {
    if (currentDateEvents.length > 0) {
      const scheduleSummary = {}
      currentDateEvents.forEach((event) => {
        const resourceName =
          resources.find((r) => r.id === event.resourceId)?.title || event.resourceId
        const startTime = dayjs(event.start).format('h:mma')
        const endTime = dayjs(event.end).format('h:mma')

        if (!scheduleSummary[resourceName]) {
          scheduleSummary[resourceName] = []
        }

        scheduleSummary[resourceName].push(`${event.title} is at ${startTime}-${endTime}`)
      })

      console.log(`Schedule Summary for ${dayjs(date).format('MMMM D, YYYY')}:`)
      Object.entries(scheduleSummary).forEach(([resourceName, events]) => {
        console.log(`${resourceName}:`)
        events.forEach((event) => console.log(`  - ${event}`))
      })
    }
  }, [currentDateEvents, resources, date])

  const handleNavigate = useCallback((newDate) => {
    console.log('Navigating to:', dayjs(newDate).format('MMMM D, YYYY'))
    setDate(newDate)
  }, [])

  const handleView = useCallback((newView) => {
    console.log('Changing view to:', newView)
    setView(newView)
  }, [])

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  const EventComponent = ({ event }) => (
    <>
      <span>{event.title} </span>
      <span className="text-sm">
        ({/* {event.time.originalRange} ⇒{' '} */}
        {formatParsedTimeRange(event.time.range[0], event.time.range[1])})
      </span>
    </>
  )

  return (
    <div>
      <Calendar
        localizer={localizer}
        events={allocatedEvents}
        resources={resources}
        resourceIdAccessor="id"
        resourceTitleAccessor={(resource) => resource.title}
        defaultView={Views.DAY}
        view={view}
        onView={handleView}
        date={date}
        onNavigate={handleNavigate}
        views={['day', 'work_week', 'month']}
        step={15}
        timeslots={4}
        defaultDate={new Date(2024, 8, 2)} // September 2, 2024
        min={new Date(2024, 8, 2, 5, 0, 0)} // 7:00 AM
        max={new Date(2024, 8, 2, 23, 0, 0)} // 7:00 PM
        toolbar={true}
        components={{
          event: EventComponent,
        }}
      />
    </div>
  )
}

function generateEventsForYear(setup, year) {
  const events = []
  const startDate = dayjs(`${year}-01-01`)
  const endDate = dayjs(`${year}-12-31`)

  for (let date = startDate; date.isSameOrBefore(endDate); date = date.add(1, 'day')) {
    if (shouldEventOccur(setup.schedule.schedule, date)) {
      const preferredTime = parseTime(setup.time.preferred)

      const baseEvent = {
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        title: setup.company,
        tech: {
          enforced: setup.tech.enforced,
          code: setup.tech.code,
          name: setup.tech.name,
        },
        time: {
          ...setup.time,
          originalRange: setup.time.originalRange,
        },
      }

      if (setup.time.enforced) {
        events.push({
          ...baseEvent,
          start: date.add(preferredTime, 'second').toDate(),
          end: date.add(preferredTime + setup.time.duration * 60, 'second').toDate(),
          time: {
            ...baseEvent.time,
            enforced: true,
            preferred: preferredTime,
            duration: setup.time.duration,
          },
        })
      } else {
        const [rangeStart, rangeEnd] = setup.time.range
        events.push({
          ...baseEvent,
          start: date.add(rangeStart, 'second').toDate(),
          end: date.add(rangeEnd, 'second').toDate(),
          time: {
            ...baseEvent.time,
            enforced: false,
            range: [rangeStart, rangeEnd],
            preferred: preferredTime,
            duration: setup.time.duration,
          },
        })
      }
    }
  }

  return events
}

function shouldEventOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  return scheduleString.charAt(dayOfYear) === '1'
}

function calculateEndTime(start, duration) {
  const startTime = convertTo24Hour(start)
  const [hours, minutes] = startTime.split(':').map(Number)

  const endDate = dayjs().set('hour', hours).set('minute', minutes).add(duration, 'minute')
  return endDate.format('HH:mm')
}

function convertTo24Hour(time) {
  const [rawTime, period] = time.split(' ')
  let [hours, minutes] = rawTime.split(':').map(Number)

  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

function allocateEventsToResources(events) {
  const techResources = new Map()
  const genericResources = []
  let genericResourceCount = 0

  // Sort events: enforced techs and times first, then by start time
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

    if (event.tech.enforced) {
      // For enforced techs, use the specific tech
      const techId = event.tech.code
      if (!techResources.has(techId)) {
        techResources.set(techId, { id: techId, title: event.tech.name })
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
