'use client'

import React, { useMemo, useEffect } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import Service from '@/app/components/Service'
import UnassignedServices from '@/app/components/UnassignedServices'
import { Progress } from '@/app/components/ui/progress'
import { useCalendar } from '@/app/hooks/useCalendar'
import { useServiceSetups } from '@/app/hooks/useServiceSetups'
import { useServices } from '@/app/hooks/useServices'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

// src/app/components/BigCalendar.js

const localizer = dayjsLocalizer(dayjs)

export default function BigCalendar() {
  const { date, view, currentViewRange, handleView, handleNavigate, handleRangeChange } =
    useCalendar()

  const {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforcedServices,
    updateAllEnforcedServices,
    enforcedServices,
  } = useServiceSetups()

  const {
    assignedServices,
    resources,
    filteredUnassignedServices,
    isScheduling,
    schedulingProgress,
  } = useServices(serviceSetups, currentViewRange, enforcedServices)

  const allServicesEnforced = useMemo(() => {
    return (
      assignedServices.length > 0 &&
      assignedServices.every(service => {
        const setupId = service.id.split('-')[0]
        return enforcedServices[setupId] ?? service.tech.enforced
      })
    )
  }, [assignedServices, enforcedServices])

  const defaultDate = new Date(2024, 8, 4)

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
            id="enforce-all-service-setups"
            checked={allServicesEnforced}
            onCheckedChange={updateAllEnforcedServices}
          >
            Enforce techs for all
          </EnforceSwitch>
          <Logo />
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
            defaultDate={defaultDate}
            onRangeChange={handleRangeChange}
            toolbar={true}
            formats={{
              eventTimeRangeFormat: () => null,
            }}
            components={{
              event: props => {
                const setupId = props.event.id.split('-')[0]
                const enforced = enforcedServices[setupId] ?? props.event.tech.enforced
                return (
                  <Service
                    service={{
                      ...props.event,
                      tech: {
                        ...props.event.tech,
                        enforced: enforced,
                      },
                    }}
                    updateEnforcedServices={updateEnforcedServices}
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
