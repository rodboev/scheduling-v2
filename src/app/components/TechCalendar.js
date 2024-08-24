// src/app/components/TechCalendar.js

'use client'

import React from 'react'
import FullCalendar from '@fullcalendar/react'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs, convertToETTime } from '@/app/utils/dayjs'

export default function TechCalendar() {
  const { data: serviceSetups, isLoading, error } = useServiceSetups()

  console.log('Raw service setups:', serviceSetups)
  console.log('Is loading:', isLoading)
  console.log('Error:', error)

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  const resources = Array.from(new Set(serviceSetups.map((setup) => setup.tech.name))).map(
    (techName) => ({ id: techName, title: techName }),
  )

  console.log('Resources:', resources)

  const events = serviceSetups.flatMap((setup) => {
    return generateEventsForYear(setup, 2024)
  })

  console.log('Processed events:', events)

  return (
    <FullCalendar
      plugins={[resourceTimelinePlugin, dayGridPlugin, interactionPlugin]}
      initialView="resourceTimelineMonth"
      resources={resources}
      events={events}
      initialDate="2024-09-01"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'resourceTimelineDay,resourceTimelineWeek,resourceTimelineMonth',
      }}
      slotDuration="00:15:00"
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
    />
  )
}

function generateEventsForYear(setup, year) {
  const events = []
  const startDate = dayjs(`${year}-01-01`)
  const endDate = dayjs(`${year}-12-31`)

  for (let date = startDate; date.isSameOrBefore(endDate); date = date.add(1, 'day')) {
    if (shouldEventOccur(setup.schedule.schedule, date)) {
      const startTime = convertTo24Hour(setup.time.preferred)
      const endTime = calculateEndTime(setup.time.preferred, parseInt(setup.time.duration))

      events.push({
        id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
        resourceId: setup.tech.name,
        title: setup.company,
        start: date.format(`YYYY-MM-DD`) + `T${startTime}`,
        end: date.format(`YYYY-MM-DD`) + `T${endTime}`,
      })
    }
  }

  return events
}

function shouldEventOccur(scheduleString, date) {
  const dayOfYear = date.dayOfYear()
  return scheduleString.charAt(dayOfYear) === '1'
}

function calculateEndTime(start, duration) {
  console.log(`Calculating end time: Start: ${start}, Duration: ${duration}`)

  const startTime = convertTo24Hour(start)
  const [hours, minutes] = startTime.split(':').map(Number)

  const endDate = dayjs().set('hour', hours).set('minute', minutes).add(duration, 'minute')
  const endTime = endDate.format('HH:mm')

  console.log(`Calculated end time: ${endTime}`)
  return endTime
}

function convertTo24Hour(time) {
  const [rawTime, period] = time.split(' ')
  let [hours, minutes] = rawTime.split(':').map(Number)

  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}
