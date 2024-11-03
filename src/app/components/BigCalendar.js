'use client'

import React, { useMemo, useCallback } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import ProgressBar from '@/app/components/ProgressBar'
import Service from '@/app/components/Service'
import UnassignedServices from '@/app/components/UnassignedServices'
import { Button } from '@/app/components/ui/button'
import { useCalendar } from '@/app/hooks/useCalendar'
import { useSchedule } from '@/app/hooks/useSchedule'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

// src/app/components/BigCalendar.js

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const defaultDate = new Date(2024, 8, 2)
  const {
    date,
    view,
    currentViewRange,
    handleView,
    handleNavigate,
    handleRangeChange,
  } = useCalendar(defaultDate)

  const {
    assignedServices,
    resources,
    filteredUnassignedServices,
    isScheduling,
    schedulingProgress,
    schedulingStatus,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule,
  } = useSchedule(currentViewRange)

  const handleForceReschedule = useCallback(() => {
    refetchSchedule()
  }, [refetchSchedule])

  const eventComponent = useCallback(
    props => (
      <Service
        service={props.event}
        updateServiceEnforcement={updateServiceEnforcement}
      />
    ),
    [updateServiceEnforcement],
  )

  const calendarComponents = useMemo(
    () => ({
      event: eventComponent,
    }),
    [eventComponent],
  )

  return (
    <div className="flex h-screen">
      {isScheduling && (
        <ProgressBar
          schedulingStatus={schedulingStatus}
          schedulingProgress={schedulingProgress}
        />
      )}
      <div className="flex flex-grow flex-col overflow-auto">
        <Header>
          <EnforceSwitch
            id="enforce-all-services"
            checked={allServicesEnforced}
            onCheckedChange={updateAllServicesEnforcement}
          >
            Enforce techs for all
          </EnforceSwitch>
          <Logo />
          <Button onClick={handleForceReschedule}>Force Reschedule</Button>
        </Header>
        <div className="flex-grow p-4">
          <Calendar
            localizer={localizer}
            dayLayoutAlgorithm="no-overlap"
            events={assignedServices}
            resources={resources}
            resourceIdAccessor="id"
            resourceTitleAccessor={resource => resource.title}
            defaultView={Views.DAY}
            view={view}
            onView={handleView}
            date={date}
            onNavigate={handleNavigate}
            views={['day', 'week', 'month']}
            step={15}
            timeslots={4}
            onRangeChange={handleRangeChange}
            toolbar={true}
            formats={{
              eventTimeRangeFormat: () => null,
            }}
            components={calendarComponents}
          />
        </div>
      </div>
    </div>
  )
}
