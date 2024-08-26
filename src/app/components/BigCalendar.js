// src/app/components/BigCalendar.js

'use client'

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Checkbox } from '@/app/components/ui/checkbox'
import { generateEventsForYear } from '@/app/utils/eventGeneration'
import { allocateEventsToResources } from '@/app/utils/eventAllocation'
import EventTooltip from '@/app/components/EventTooltip'

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
  } = useServiceSetups()
  const [date, setDate] = useState(new Date(2024, 8, 2)) // September 2, 2024
  const [view, setView] = useState(Views.DAY)
  const [enforceTechs, setEnforceTechs] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const popoverRef = useRef(null)

  const { allocatedEvents, resources } = useMemo(() => {
    if (!serviceSetups) return { allocatedEvents: [], resources: [] }

    const rawEvents = serviceSetups.flatMap((setup) => {
      return generateEventsForYear(setup, 2024)
    })

    return allocateEventsToResources(rawEvents, enforceTechs)
  }, [serviceSetups, enforceTechs])

  useEffect(() => {
    if (serviceSetups) {
      const allEnforced = serviceSetups.every((setup) => setup.tech.enforced)
      setEnforceTechs(allEnforced)
    }
  }, [serviceSetups])

  const handleNavigate = useCallback((newDate) => {
    setDate(newDate)
  }, [])

  const handleView = useCallback((newView) => {
    setView(newView)
  }, [])

  const handleEnforceTechsChange = useCallback(
    (checked) => {
      setEnforceTechs(checked)
      updateAllEnforced(checked)
    },
    [updateAllEnforced],
  )

  const handleEnforceTechChange = useCallback(
    (id, checked) => {
      console.log(`Updating enforced for ${id} to ${checked}`)
      updateEnforced(id, checked)
    },
    [updateEnforced],
  )

  const handleSelectEvent = useCallback((event) => {
    setSelectedEvent(event)
  }, [])

  const EventComponent = ({ event }) => (
    <EventTooltip event={event} handleEnforceTechChange={handleEnforceTechChange} />
  )

  return (
    <div>
      <div className="mb-4">
        <label className="checkbox-hover flex cursor-pointer items-center space-x-2">
          <Checkbox checked={enforceTechs} onCheckedChange={handleEnforceTechsChange} />
          <span>Enforce Techs</span>
        </label>
      </div>
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
        onSelectEvent={handleSelectEvent}
      />
    </div>
  )
}
