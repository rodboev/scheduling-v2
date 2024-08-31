// src/app/components/BigCalendar.js

'use client'

import React, { useMemo } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { useCalendarState } from '@/app/hooks/useCalendarState'
import { useEventGeneration } from '@/app/hooks/useEventGeneration'

import UnallocatedEvents from '@/app/components/UnallocatedEvents'
import Header from '@/app/components/Header'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Logo from '@/app/components/Logo'
import Event from '@/app/components/Event'

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

  const { allocatedEvents, resources, filteredUnallocatedEvents, summaryText } = useEventGeneration(
    serviceSetups,
    currentViewRange,
    enforcedServiceSetups,
  )

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
          <div>{summaryText}</div>
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
