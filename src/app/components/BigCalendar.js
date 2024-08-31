// src/app/components/BigCalendar.js

'use client'

import React, { useMemo } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import UnallocatedEvents from '@/app/components/UnallocatedEvents'
import Event from '@/app/components/Event'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { useCalendarState } from '@/app/hooks/useCalendarState'
import { useEventGeneration } from '@/app/hooks/useEventGeneration'

import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import { Card, CardContent } from '@/app/components/ui/card'
import { Switch } from '@/app/components/ui/switch'
import { Label } from '@/app/components/ui/label'

const localizer = dayjsLocalizer(dayjs)

// src/app/components/BigCalendar.js

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

  const handleEnforceServiceSetup = (id, checked) => {
    updateEnforced(id, checked)
  }

  const handleEnforceAllServiceSetups = (checked) => {
    updateAllEnforced(checked)
  }

  return (
    <div className="flex h-screen">
      <div className="w-64 border-r">
        <UnallocatedEvents events={filteredUnallocatedEvents} />
      </div>
      <div className="flex flex-grow flex-col">
        <Header>
          <Card className="w-fit overflow-hidden hover:border-neutral-300 hover:bg-neutral-100">
            <CardContent className="p-0">
              <Label
                htmlFor="enforce-all-service-setups"
                className="flex cursor-pointer items-center space-x-3 p-3 px-4"
              >
                <Switch
                  className="focus-visible:ring-transparent"
                  checked={allServiceSetupsEnforced}
                  onCheckedChange={updateAllEnforced}
                  id="enforce-all-service-setups"
                />
                <span>Enforce all techs</span>
              </Label>
            </CardContent>
          </Card>
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
              event: (props) => (
                <Event
                  {...props}
                  updateEnforced={updateEnforced}
                  enforcedServiceSetups={enforcedServiceSetups}
                />
              ),
            }}
          />
        </div>
      </div>
    </div>
  )
}
