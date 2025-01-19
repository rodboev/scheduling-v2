'use client'

import EnforceSwitch from '@/app/calendar/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import ProgressBar from '@/app/components/ProgressBar'
import Service from '@/app/components/Service'
import { Button } from '@/app/components/ui/button'
import { useCalendar } from '@/app/hooks/useCalendar'
import { useSchedule } from '@/app/hooks/useSchedule'
import { DEFAULT_DATE } from '@/app/utils/constants'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calendar, dayjsLocalizer as createDayjsLocalizer, Views } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const UPDATE_INTERVAL = 100 // 100ms between UI updates

const MIN_TIME = new Date(2024, 0, 1, 0, 0, 0) // 12:00 AM
const MAX_TIME = new Date(2024, 0, 1, 23, 59, 59) // 11:59 PM
const SCROLL_TO_TIME = new Date(2024, 0, 1, 4, 30, 0) // 4:30 AM

// Create the localizer using react-big-calendar's factory function
const localizer = createDayjsLocalizer(dayjs)

export default function BigCalendar() {
  const defaultDate = dayjs(DEFAULT_DATE).toDate()
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now())

  const { date, view, currentViewRange, handleView, handleNavigate, handleRangeChange } =
    useCalendar(defaultDate)

  const {
    assignedServices,
    resources,
    isScheduling,
    schedulingProgress,
    schedulingStatus,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule,
  } = useSchedule(currentViewRange)

  // Add debugging logs
  useEffect(() => {
    console.log('Calendar data:', {
      assignedServices: assignedServices?.length,
      resources: resources?.length,
      currentViewRange,
    })
  }, [assignedServices, resources, currentViewRange])

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
    console.log('Force reschedule triggered')
    refetchSchedule()
  }, [refetchSchedule])

  // Create an absolutely empty event component
  const eventComponent = useCallback(
    props => {
      // console.log('Rendering event:', props.event)
      return (
        <div className="select-none">
          <Service service={props.event} updateServiceEnforcement={updateServiceEnforcement} />
        </div>
      )
    },
    [updateServiceEnforcement],
  )

  // Create custom toolbar component
  const customToolbar = useCallback(
    toolbar => {
      const label = (
        <>
          {toolbar.label}
          {!isScheduling && (
            <span className="ml-10 text-gray-500">{assignedServices?.length > 0 ? `${assignedServices?.length} services` : ''}</span>
          )}
        </>
      )
      
      return (
        <div className="rbc-toolbar">
          <span className="rbc-btn-group">
            <button type="button" onClick={() => toolbar.onNavigate('PREV')}>Back</button>
            <button type="button" onClick={() => toolbar.onNavigate('TODAY')}>Today</button>
            <button type="button" onClick={() => toolbar.onNavigate('NEXT')}>Next</button>
          </span>
          <span className="rbc-toolbar-label ml-20">{label}</span>
          <span className="rbc-btn-group">
            {toolbar.views.map(view => (
              <button
                key={view}
                type="button"
                className={`capitalize ${view === toolbar.view ? 'rbc-active' : ''}`}
                onClick={() => toolbar.onView(view)}
              >
                {view}
              </button>
            ))}
          </span>
        </div>
      )
    },
    [isScheduling, assignedServices?.length]
  )

  const calendarComponents = useMemo(
    () => ({
      event: eventComponent,
      toolbar: customToolbar,  // Add custom toolbar component
    }),
    [eventComponent, customToolbar]
  )

  // Add click capture handler
  const handleClickCapture = useCallback(e => {
    e.stopPropagation()
    e.preventDefault()
  }, [])

  return (
    <div className="flex h-screen">
      {isScheduling && (
        <ProgressBar schedulingStatus={schedulingStatus} schedulingProgress={schedulingProgress} />
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
        <div className="flex-grow p-4 h-[90vh]">
          <Calendar
            localizer={localizer}
            dayLayoutAlgorithm="no-overlap"
            events={assignedServices}
            resources={resources}
            resourceIdAccessor="id"
            date={date}
            view={view}
            onView={handleView}
            onNavigate={handleNavigate}
            onRangeChange={handleRangeChange}
            views={['day', 'week', 'month']}
            defaultView={Views.DAY}
            step={15}
            timeslots={4}
            toolbar={true}
            formats={{
              eventTimeRangeFormat: () => null,
            }}
            draggableAccessor={() => false}
            resizable={false}
            min={MIN_TIME}
            max={MAX_TIME}
            scrollToTime={SCROLL_TO_TIME}
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
