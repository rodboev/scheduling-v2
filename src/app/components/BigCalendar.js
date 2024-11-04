'use client'

import React, { useMemo, useCallback, useEffect, useState } from 'react'
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
import { AutoSizer, List } from 'react-virtualized'

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

  // Memoize the event handlers to prevent recreating on every render
  const handleSelectEvent = useCallback(event => {
    // Add any event selection logic here
    // For now, just prevent default behavior that might cause freezing
    return false
  }, [])

  const resourceAccessor = useCallback(resource => resource.title, [])

  // Memoize the calendar props to prevent unnecessary re-renders
  const calendarProps = useMemo(
    () => ({
      localizer,
      dayLayoutAlgorithm: 'no-overlap',
      events: assignedServices,
      resources,
      resourceIdAccessor: 'id',
      resourceTitleAccessor: resourceAccessor,
      defaultView: Views.DAY,
      view,
      date,
      views: ['day', 'week', 'month'],
      step: 15,
      timeslots: 4,
      toolbar: true,
      formats: {
        timeGutterFormat: 'h:mm A',
        eventTimeRangeFormat: ({ start, end }) =>
          `${dayjs(start).format('h:mm A')} - ${dayjs(end).format('h:mm A')}`,
      },
      components: {
        ...calendarComponents,
        timeSlotWrapper: ({ children }) => (
          <div className="rbc-time-slot">{children}</div>
        ),
      },
      onSelectEvent: handleSelectEvent,
      length: 7,
      draggableAccessor: () => false,
      resizable: false,
      min: MIN_TIME,
      max: MAX_TIME,
      scrollToTime: dayjs().startOf('day').add(6, 'hour').toDate(), // Scroll to 6 AM
    }),
    [
      assignedServices,
      resources,
      view,
      date,
      calendarComponents,
      resourceAccessor,
      handleSelectEvent,
    ],
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
          <Calendar {...calendarProps} />
        </div>
      </div>
    </div>
  )
}
