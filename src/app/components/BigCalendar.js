// src/app/components/BigCalendar.js

'use client'

import React, { useState, useEffect } from 'react'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs, createDateRange } from '@/app/utils/dayjs'
import { parseTime } from '@/app/utils/timeRange'
import { generateEventsForDateRange } from '@/app/utils/eventGeneration'
import { scheduleEvents } from '@/app/utils/scheduler'
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
  const [currentViewRange, setCurrentViewRange] = useState(() => createDateRange(date, date))
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

  const allTechsEnforced =
    allocatedEvents.length > 0 &&
    allocatedEvents.every((event) =>
      enforcedUpdates.hasOwnProperty(event.id.split('-')[0])
        ? enforcedUpdates[event.id.split('-')[0]]
        : event.tech.enforced,
    )

  useEffect(() => {
    syncEnforcedUpdates()
  }, [])

  useEffect(() => {
    if (serviceSetups) {
      // Only generate events for the visible range
      const visibleStart = dayjs(currentViewRange.start).startOf('day')
      const visibleEnd = dayjs(currentViewRange.end).endOf('day')

      const rawEvents = serviceSetups.flatMap((setup) => {
        const enforced = enforcedUpdates.hasOwnProperty(setup.id)
          ? enforcedUpdates[setup.id]
          : setup.tech.enforced
        return generateEventsForDateRange(
          { ...setup, tech: { ...setup.tech, enforced } },
          visibleStart,
          visibleEnd,
        )
      })

      // Create a resource for each unique tech code
      const allResources = [...new Set(rawEvents.map((event) => event.tech.code))].map(
        (tech, index) => ({
          id: tech,
          title: allTechsEnforced ? tech : `Tech ${index + 1}`,
        }),
      )

      console.log('All possible resources:', allResources)

      if (allTechsEnforced) {
        const scheduledEvents = rawEvents.map((event) => {
          const preferredTime = parseTime(event.time.preferred)
          const startDate = dayjs(event.start).startOf('day').add(preferredTime, 'second')
          return {
            ...event,
            resourceId: event.tech.code,
            start: startDate.toDate(),
            end: startDate.add(event.time.duration, 'minute').toDate(),
          }
        })
        setAllocatedEvents(scheduledEvents)
        setResources(allResources)
        setUnallocatedEvents([])
        setSummaryText(`Scheduled: ${scheduledEvents.length}, Unscheduled: 0`)
      } else {
        const { scheduledEvents, unscheduledEvents } = scheduleEvents(
          rawEvents,
          allResources,
          false,
          visibleStart,
          visibleEnd,
        )

        // Determine which resources were actually used in scheduled events
        const usedResourceIds = new Set(scheduledEvents.map((event) => event.resourceId))
        const finalResources = allResources.filter((resource) => usedResourceIds.has(resource.id))

        setAllocatedEvents(
          scheduledEvents.map((event) => ({
            ...event,
            start: new Date(event.start),
            end: new Date(event.end),
          })),
        )
        setResources(finalResources)
        setUnallocatedEvents(unscheduledEvents)
        setSummaryText(
          `Scheduled: ${scheduledEvents.length}, Unscheduled: ${unscheduledEvents.length}`,
        )
      }
    }
  }, [serviceSetups, enforcedUpdates, currentViewRange, allTechsEnforced])

  function handleEnforceTechChange(id, checked) {
    const { setupId, enforced } = updateEnforced(id, checked)
    setEnforcedUpdates((prev) => {
      const newUpdates = { ...prev, [setupId]: enforced }
      return newUpdates
    })
  }

  function handleEnforceTechsChange(checked) {
    const newEnforcedUpdates = serviceSetups.reduce((acc, setup) => {
      acc[setup.id] = checked
      return acc
    }, {})
    setEnforcedUpdates(newEnforcedUpdates)
    updateAllEnforced(checked)
  }

  function handleView(newView) {
    setView(newView)
  }

  function handleNavigate(newDate) {
    setDate(newDate)
    setCurrentViewRange(createDateRange(newDate, newDate))
  }

  function handleRangeChange(range) {
    const [start, end] = Array.isArray(range)
      ? [range[0], range[range.length - 1]]
      : [range.start, range.start]

    const newRange = createDateRange(start, end)

    setCurrentViewRange(newRange)
  }

  const filteredUnallocatedEvents = unallocatedEvents
    .filter((unallocatedEvent) => {
      const eventDate = dayjs(unallocatedEvent.start)
      return eventDate.isBetween(currentViewRange.start, currentViewRange.end, null, '[]')
    })
    .map((event) => ({
      ...event,
      company: event.company || 'Unknown Company',
      title: event.title || 'Untitled Event',
      start: event.start || new Date(),
      end: event.end || new Date(),
      // Don't overwrite the reason if it exists
      reason: event.reason || 'No reason provided',
    }))

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
            min={new Date(2024, 8, 2, 0, 0, 0)}
            max={new Date(2024, 8, 2, 23, 59, 0)}
            onRangeChange={handleRangeChange}
            toolbar={true}
            formats={{
              eventTimeRangeFormat: () => null, // This disables the default time display
            }}
            components={{
              event: EventComponent,
            }}
          />
        </div>
      </div>
    </div>
  )
}
