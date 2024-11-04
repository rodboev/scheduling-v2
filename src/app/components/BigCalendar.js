'use client'

import React, { useMemo, useCallback, useEffect, useState } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import ProgressBar from '@/app/components/ProgressBar'
import Service from '@/app/components/Service'
import { Button } from '@/app/components/ui/button'
import { useCalendar } from '@/app/hooks/useCalendar'
import { useSchedule } from '@/app/hooks/useSchedule'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Calendar, Views, dayjsLocalizer } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const localizer = dayjsLocalizer(dayjs)
const UPDATE_INTERVAL = 100 // 100ms between UI updates

const MIN_TIME = new Date(2024, 0, 1, 0, 0, 0) // 12:00 AM
const MAX_TIME = new Date(2024, 0, 1, 23, 59, 59) // 11:59 PM

export default function BigCalendar() {
  const defaultDate = new Date(2024, 8, 2)
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now())

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
    unassignedServices,
    isScheduling,
    schedulingProgress,
    schedulingStatus,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule,
  } = useSchedule(currentViewRange)

  // Effect to ensure UI updates regularly during scheduling
  useEffect(() => {
    if (isScheduling) {
      const interval = setInterval(() => {
        const currentTime = Date.now()
        if (currentTime - lastUpdateTime >= UPDATE_INTERVAL) {
          setLastUpdateTime(currentTime)
        }
      }, UPDATE_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [isScheduling, lastUpdateTime])

  const handleForceReschedule = useCallback(() => {
    refetchSchedule()
  }, [refetchSchedule])

  // Create an absolutely empty event component
  const eventComponent = useCallback(
    props => (
      <div className="select-none">
        <Service
          service={props.event}
          updateServiceEnforcement={updateServiceEnforcement}
        />
      </div>
    ),
    [updateServiceEnforcement],
  )

  const calendarComponents = useMemo(
    () => ({
      event: eventComponent,
    }),
    [eventComponent],
  )

  // Add click capture handler
  const handleClickCapture = useCallback(e => {
    e.stopPropagation()
    e.preventDefault()
  }, [])

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
        <div
          className="flex-grow p-4"
          onClickCapture={handleClickCapture}
        >
          <Calendar
            localizer={localizer}
            dayLayoutAlgorithm="no-overlap"
            events={assignedServices}
            resources={resources}
            resourceIdAccessor="id"
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
            draggableAccessor={() => false}
            resizable={false}
            min={MIN_TIME}
            max={MAX_TIME}
            components={calendarComponents}
            selectable={false}
            onSelectEvent={null}
            onSelectSlot={null}
            onClick={null}
            onDoubleClick={null}
            onKeyPressEvent={null}
            onDragStart={null}
            onDragOver={null}
            onDrop={null}
            eventPropGetter={() => ({
              style: { cursor: 'pointer' },
            })}
            slotPropGetter={() => ({
              style: { cursor: 'default' },
            })}
          />
        </div>
      </div>
    </div>
  )
}
