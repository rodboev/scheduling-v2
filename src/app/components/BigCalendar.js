// src/app/components/BigCalendar.js

'use client'

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { scheduleEvents } from '@/app/utils/scheduler'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Checkbox } from '@/app/components/ui/checkbox'
import { generateEventsForYear } from '@/app/utils/eventGeneration'
import EventTooltip from '@/app/components/EventTooltip'
import UnallocatedEvents from '@/app/components/UnallocatedEvents'
import ChangedEvents from '@/app/components/ChangedEvents'

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

  const { scheduledEvents, resources, unscheduledEvents } = useMemo(() => {
    if (!serviceSetups) return { scheduledEvents: [], resources: [], unscheduledEvents: [] }

    const rawEvents = serviceSetups.flatMap((setup) => {
      return generateEventsForYear(setup, 2024)
    })

    let resources = []
    let scheduledEvents = []
    let unscheduledEvents = []

    if (enforceTechs) {
      const uniqueTechs = [...new Set(rawEvents.map((event) => event.tech.code))]
      resources = uniqueTechs.map((tech) => ({ id: tech, title: tech }))
      const result = scheduleEvents(rawEvents, resources, true)
      scheduledEvents = result.scheduledEvents
      unscheduledEvents = result.unscheduledEvents
    } else {
      // Start with no resources and add them as needed
      let remainingEvents = [...rawEvents]
      let techCounter = 1

      while (remainingEvents.length > 0 && techCounter <= 10) {
        // Limit to 10 techs max
        const newResource = { id: `Tech ${techCounter}`, title: `Tech ${techCounter}` }
        resources.push(newResource)

        const result = scheduleEvents(remainingEvents, [newResource], false)
        scheduledEvents = [...scheduledEvents, ...result.scheduledEvents]
        remainingEvents = result.unscheduledEvents

        if (result.scheduledEvents.length === 0) {
          // If no events were scheduled with this new resource, remove it and break
          resources.pop()
          break
        }

        techCounter++
      }

      unscheduledEvents = remainingEvents
    }

    return { scheduledEvents, resources, unscheduledEvents }
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

  const [currentViewRange, setCurrentViewRange] = useState({
    start: date,
    end: date,
  })

  const filteredUnscheduledEvents = useMemo(() => {
    return unscheduledEvents.filter((unscheduledEvent) => {
      const eventDate = dayjs(unscheduledEvent.start)
      return eventDate.isBetween(currentViewRange.start, currentViewRange.end, null, '[]')
    })
  }, [unscheduledEvents, currentViewRange])

  const handleRangeChange = useCallback((range) => {
    setCurrentViewRange({
      start: range.start,
      end: range.end,
    })
  }, [])

  return (
    <div className="flex">
      <div className="w-64 overflow-auto">
        <UnallocatedEvents events={filteredUnscheduledEvents} />
      </div>
      <div className="flex-grow">
        <div className="mb-4">
          <label className="checkbox-hover flex cursor-pointer items-center space-x-2">
            <Checkbox checked={enforceTechs} onCheckedChange={handleEnforceTechsChange} />
            <span>Enforce Techs</span>
          </label>
        </div>
        <Calendar
          localizer={localizer}
          events={scheduledEvents}
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
          min={new Date(2024, 8, 2, 5, 0, 0)} // 5:00 AM
          max={new Date(2024, 8, 2, 23, 0, 0)} // 11:00 PM
          onRangeChange={handleRangeChange}
          onSelectEvent={handleSelectEvent}
          toolbar={true}
          components={{
            event: EventComponent,
          }}
        />
      </div>
    </div>
  )
}
