// src/app/components/TechCalendar.js

'use client'

import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'

// FullCalendar Non-Commercial License: https://fullcalendar.io/license/non-commercial

const queryClient = new QueryClient()

function Calendar() {
  const { data: serviceSetups, isLoading, isError, error } = useServiceSetups()

  if (isLoading) return <div>Loading...</div>
  if (isError) return <div>Error fetching data: {error.message}</div>

  const resources = Array.from(new Set(serviceSetups.map((setup) => setup.tech.name))).map(
    (techName) => ({ id: techName, title: techName }),
  )

  const events = serviceSetups.map((setup) => ({
    id: setup.id,
    resourceId: setup.tech.name,
    title: setup.company,
    start: `2024-09-02T${setup.time.preferred}`,
    end: `2024-09-02T${calculateEndTime(setup.time.preferred, setup.time.duration)}`,
    extendedProps: {
      location: setup.locationCode,
      comments: setup.comments,
      techCode: setup.tech.code,
      scheduleCode: setup.schedule.code,
      scheduleDescription: setup.schedule.description,
    },
  }))

  return (
    <FullCalendar
      plugins={[resourceTimelinePlugin, dayGridPlugin, interactionPlugin]}
      initialView="resourceTimelineDay"
      resources={resources}
      events={events}
      initialDate="2024-09-02"
      slotDuration="00:15:00"
      slotMinTime="05:00:00"
      slotMaxTime="05:00:00"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'resourceTimelineDay,dayGridMonth',
      }}
      eventContent={(eventInfo) => (
        <>
          <b>{eventInfo.timeText}</b>
          <i>{eventInfo.event.title}</i>
        </>
      )}
      eventClick={(info) => {
        alert(
          `Service Details:
          \nCompany: ${info.event.title}
          \nLocation: ${info.event.extendedProps.location}
          \nTech: ${info.event.extendedProps.techCode}
          \nSchedule: ${info.event.extendedProps.scheduleCode} - ${info.event.extendedProps.scheduleDescription}
          \nComments: ${info.event.extendedProps.comments.serviceSetup}
          \nLocation Comments: ${info.event.extendedProps.comments.location}`,
        )
      }}
    />
  )
}

function calculateEndTime(start, duration) {
  const [hours, minutes] = start.split(':').map(Number)
  const durationMinutes = parseInt(duration)
  const endDate = new Date(2024, 8, 2, parseInt(hours), parseInt(minutes) + parseInt(duration))
  return endDate.toTimeString().slice(0, 5)
}

export default function TechCalendar() {
  return (
    <QueryClientProvider client={queryClient}>
      <Calendar />
    </QueryClientProvider>
  )
}
