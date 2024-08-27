// src/app/components/BigCalendar.js

'use client'

import React, { useMemo, useCallback, useState, useEffect } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Checkbox } from '@/app/components/ui/checkbox'
import { generateEventsForYear } from '@/app/utils/eventGeneration'
import { allocateEventsToResources } from '@/app/utils/eventAllocation'
import EventTooltip from '@/app/components/EventTooltip'
import UnallocatedEvents from '@/app/components/UnallocatedEvents'

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

  const { allocatedEvents, resources, unallocatedEvents, summaryText } = useMemo(() => {
    if (!serviceSetups)
      return { allocatedEvents: [], resources: [], unallocatedEvents: [], summaryText: '' }

    const rawEvents = serviceSetups.flatMap((setup) => generateEventsForYear(setup, 2024))

    const result = allocateEventsToResources(rawEvents, enforceTechs)
    console.log('Allocation result:', result) // Add this line for debugging
    return result
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

  const [currentViewRange, setCurrentViewRange] = useState({
    start: date,
    end: date,
  })

  const filteredUnallocatedEvents = useMemo(() => {
    console.log('Unallocated events before filtering:', unallocatedEvents) // Add this line
    const filtered = unallocatedEvents.filter((unallocatedEvent) => {
      const eventDate = dayjs(unallocatedEvent.event.start)
      return eventDate.isBetween(currentViewRange.start, currentViewRange.end, null, '[]')
    })
    console.log('Filtered unallocated events:', filtered) // Add this line
    return filtered
  }, [unallocatedEvents, currentViewRange])

  const handleRangeChange = useCallback((range) => {
    setCurrentViewRange({
      start: range.start,
      end: range.end,
    })
  }, [])

  const EventComponent = useCallback(
    ({ event }) => (
      <EventTooltip
        event={event}
        handleEnforceTechChange={(checked) => {
          handleEnforceTechChange(event.id, checked)
        }}
      />
    ),
    [handleEnforceTechChange],
  )

  console.log('Rendering UnallocatedEvents with:', filteredUnallocatedEvents)

  return (
    <div className="flex">
      <div className="w-64 overflow-auto">
        <UnallocatedEvents events={filteredUnallocatedEvents} />
      </div>
      <div className="flex-grow">
        <div className="mb-4">
          <label className="checkbox-hover flex cursor-pointer items-center space-x-2">
            <Checkbox checked={enforceTechs} onCheckedChange={handleEnforceTechsChange} />
            <span>Enforce All Techs</span>
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
          min={new Date(2024, 8, 2, 5, 0, 0)} // 5:00 AM
          max={new Date(2024, 8, 2, 23, 0, 0)} // 11:00 PM
          onRangeChange={handleRangeChange}
          toolbar={true}
          components={{
            event: EventComponent,
          }}
        />
      </div>
    </div>
  )
}
