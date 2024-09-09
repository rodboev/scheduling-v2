'use client'

import React, { useMemo, useEffect } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import Service from '@/app/components/Service'
import UnassignedServices from '@/app/components/UnassignedServices'
import { Button } from '@/app/components/ui/button'
import { Progress } from '@/app/components/ui/progress'
import { useCalendar } from '@/app/hooks/useCalendar'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { useSchedule } from '@/app/hooks/useSchedule'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

// src/app/components/BigCalendar.js

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const defaultDate = new Date(2024, 8, 2)
  const { date, view, currentViewRange, handleView, handleNavigate, handleRangeChange } =
    useCalendar(defaultDate)

  const {
    assignedServices,
    resources,
    filteredUnassignedServices,
    isScheduling,
    schedulingProgress,
    refetchSchedule,
  } = useSchedule(currentViewRange)

  const { updateServiceEnforcement, updateAllServicesEnforcement, allServicesEnforced } =
    useEnforcement(assignedServices, refetchSchedule)

  const handleForceReschedule = () => {
    refetchSchedule()
  }

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
        <UnassignedServices services={filteredUnassignedServices} />
      </div>
      <div className="flex flex-grow flex-col">
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
            components={{
              event: props => {
                return (
                  <Service
                    service={props.event}
                    updateServiceEnforcement={updateServiceEnforcement}
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
