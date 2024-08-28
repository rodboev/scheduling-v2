// src/app/components/BigCalendar.js

'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Checkbox } from '@/app/components/ui/checkbox'
import { generateEventsForDateRange } from '@/app/utils/eventGeneration'
import { allocateEventsToResources } from '@/app/utils/eventAllocation'
import EventTooltip from '@/app/components/EventTooltip'
import UnallocatedEvents from '@/app/components/UnallocatedEvents'
import { Switch } from '@/app/components/ui/switch'
import { Label } from '@/app/components/ui/label'
import { Card, CardContent } from '@/app/components/ui/card'
import { useLocalStorage } from '@/app/hooks/useLocalStorage'

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const [date, setDate] = useState(new Date(2024, 8, 2)) // September 2, 2024
  const [view, setView] = useState(Views.DAY)
  const [currentViewRange, setCurrentViewRange] = useState(() => {
    const start = new Date(date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  })
  const [enforcedUpdates, setEnforcedUpdates, syncEnforcedUpdates] = useLocalStorage(
    'enforcedUpdates',
    {},
  )
  const [allocatedEvents, setAllocatedEvents] = useState([])
  const [resources, setResources] = useState([])
  const [unallocatedEvents, setUnallocatedEvents] = useState([])
  const [summaryText, setSummaryText] = useState('')

  const {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
  } = useServiceSetups(currentViewRange.start, currentViewRange.end)

  useEffect(() => {
    syncEnforcedUpdates()
  }, [])

  useEffect(() => {
    if (serviceSetups) {
      const rawEvents = serviceSetups.flatMap((setup) => {
        const enforced = enforcedUpdates.hasOwnProperty(setup.id)
          ? enforcedUpdates[setup.id]
          : setup.tech.enforced
        return generateEventsForDateRange(
          { ...setup, tech: { ...setup.tech, enforced } },
          currentViewRange.start,
          currentViewRange.end,
        )
      })
      const result = allocateEventsToResources(rawEvents)
      setAllocatedEvents(result.allocatedEvents)
      setResources(result.resources)
      setUnallocatedEvents(result.unallocatedEvents)
      setSummaryText(result.summaryText)
    }
  }, [serviceSetups, enforcedUpdates, currentViewRange])

  const allTechsEnforced =
    serviceSetups &&
    serviceSetups.length > 0 &&
    serviceSetups.every((setup) =>
      enforcedUpdates.hasOwnProperty(setup.id) ? enforcedUpdates[setup.id] : setup.tech.enforced,
    )

  function handleNavigate(newDate) {
    setDate(newDate)
    const start = new Date(newDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(newDate)
    end.setHours(23, 59, 59, 999)
    setCurrentViewRange({ start, end })
  }

  function handleRangeChange(range) {
    let start, end
    if (Array.isArray(range)) {
      // For work week and month views
      ;[start, end] = range
      start = new Date(start.setHours(0, 0, 0, 0))
      end = new Date(end.setHours(23, 59, 59, 999))
    } else {
      // For day view
      start = new Date(range.start.setHours(0, 0, 0, 0))
      end = new Date(range.start.setHours(23, 59, 59, 999))
    }
    setCurrentViewRange({ start, end })
  }

  function handleView(newView) {
    setView(newView)
  }

  function handleEnforceTechsChange(checked) {
    if (checked) {
      const newEnforcedUpdates = serviceSetups.reduce((acc, setup) => {
        acc[setup.id] = true
        return acc
      }, {})
      setEnforcedUpdates(newEnforcedUpdates)
    } else {
      setEnforcedUpdates({})
    }
    updateAllEnforced(checked)
    setDate(new Date(date))
  }

  function handleEnforceTechChange(id, checked) {
    console.log(`BigCalendar: Updating enforced for ${id} to ${checked}`)
    const { setupId, enforced } = updateEnforced(id, checked)
    setEnforcedUpdates((prev) => {
      const newUpdates = { ...prev, [setupId]: enforced }
      console.log('New enforcedUpdates:', newUpdates)
      return newUpdates
    })
    setDate(new Date(date))
  }

  const filteredUnallocatedEvents = unallocatedEvents.filter((unallocatedEvent) => {
    const eventDate = dayjs(unallocatedEvent.event.start)
    return eventDate.isBetween(currentViewRange.start, currentViewRange.end, null, '[]')
  })

  function EventComponent({ event }) {
    const setupId = event.id.split('-')[0]
    const enforced = enforcedUpdates.hasOwnProperty(setupId)
      ? enforcedUpdates[setupId]
      : event.tech.enforced

    return (
      <EventTooltip
        event={{
          ...event,
          tech: {
            ...event.tech,
            enforced: enforced,
          },
        }}
        handleEnforceTechChange={handleEnforceTechChange}
      />
    )
  }

  console.log('Current view range:', currentViewRange.start, currentViewRange.end)
  console.log('Rendering UnallocatedEvents with:', filteredUnallocatedEvents)

  return (
    <div className="flex h-screen">
      <div className="w-64 border-r">
        <UnallocatedEvents events={filteredUnallocatedEvents} />
      </div>
      <div className="flex flex-grow flex-col">
        <div className="flex items-center justify-between border-b p-4">
          <Card className="w-fit overflow-hidden hover:border-neutral-300 hover:bg-neutral-100">
            <CardContent className="p-0">
              <Label
                htmlFor="enforce-all-techs"
                className="flex cursor-pointer items-center space-x-3 p-3 px-4"
              >
                <Switch
                  className="focus-visible:ring-transparent"
                  checked={allTechsEnforced}
                  onCheckedChange={handleEnforceTechsChange}
                  id="enforce-all-techs"
                />
                <span>Enforce All Techs</span>
              </Label>
            </CardContent>
          </Card>
          <div className="logo flex-grow text-center tracking-tighter">
            <span className="display-inline mx-1 text-5xl font-bold text-teal-500">liberty</span>
            <span className="display-inline mx-1 text-2xl">schedule</span>
          </div>
          <div className="w-[200px]"></div> {/* Placeholder to balance the layout */}
        </div>

        <div className="flex-grow p-4">
          <Calendar
            localizer={localizer}
            dayLayoutAlgorithm="no-overlap"
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
            defaultDate={new Date(2024, 8, 2)}
            min={new Date(2024, 8, 2, 5, 0, 0)}
            max={new Date(2024, 8, 2, 23, 0, 0)}
            onRangeChange={handleRangeChange}
            toolbar={true}
            components={{
              event: EventComponent,
            }}
          />
        </div>
      </div>
    </div>
  )
}
