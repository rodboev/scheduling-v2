'use client'

import React, { useMemo, useEffect } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Event from '@/app/components/Event'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import UnallocatedEvents from '@/app/components/UnallocatedEvents'
import { Progress } from '@/app/components/ui/progress'
import { useCalendarState } from '@/app/hooks/useCalendarState'
import { useEventGeneration } from '@/app/hooks/useEventGeneration'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

// src/app/components/BigCalendar.js

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const { date, view, currentViewRange, handleView, handleNavigate, handleRangeChange } =
    useCalendarState()

  const {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
    enforcedServiceSetups,
  } = useServiceSetups()

  const {
    allocatedEvents,
    resources,
    filteredUnallocatedEvents,
    isScheduling,
    schedulingProgress,
  } = useEventGeneration(serviceSetups, currentViewRange, enforcedServiceSetups)

  const allServiceSetupsEnforced = useMemo(() => {
    return (
      allocatedEvents.length > 0 &&
      allocatedEvents.every((event) => {
        const setupId = event.id.split('-')[0]
        return enforcedServiceSetups[setupId] ?? event.tech.enforced
      })
    )
  }, [allocatedEvents, enforcedServiceSetups])

  return (
    <div className="flex h-screen">
      {isScheduling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/50">
          <div className="w-80 space-y-5 rounded-lg border p-5 backdrop-blur-md">
            <p className="text-center">Scheduling...</p>
            <Progress
              value={schedulingProgress}
              className="w-full"
            />
          </div>
        </div>
      )}
      <div className="w-64 border-r">
        <UnallocatedEvents events={filteredUnallocatedEvents} />
      </div>
      <div className="flex flex-grow flex-col">
        <Header>
          <EnforceSwitch
            id="enforce-all-service-setups"
            checked={allServiceSetupsEnforced}
            onCheckedChange={updateAllEnforced}
          >
            Enforce all techs
          </EnforceSwitch>
          <Logo />
        </Header>
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
              eventTimeRangeFormat: () => null,
            }}
            components={{
              event: (props) => {
                const setupId = props.event.id.split('-')[0]
                const enforced = enforcedServiceSetups[setupId] ?? props.event.tech.enforced
                return (
                  <Event
                    event={{
                      ...props.event,
                      tech: {
                        ...props.event.tech,
                        enforced: enforced,
                      },
                    }}
                    updateEnforced={updateEnforced}
                  />
                )
              },
            }}
          />
        </div>
      </div>
    </div>
  )
}
