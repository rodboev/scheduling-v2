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
    totalServices,
    unscheduledServices,
    schedulingDetails
  } = useSchedule(currentViewRange)

  // Add debugging logs
  useEffect(() => {
    console.log('Calendar data:', {
      assignedServices: assignedServices?.length,
      resources: resources?.length,
      totalServices,
      unscheduledServices,
      currentViewRange,
    })
  }, [assignedServices, resources, currentViewRange, totalServices, unscheduledServices])

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

  // Count services that are actually rendered in the current view
  const countRenderedServices = useCallback(() => {
    if (!assignedServices?.length) return 0
    
    // For day view, count services that start on the current date
    if (view === Views.DAY) {
      const currentDateStr = dayjs(date).format('YYYY-MM-DD')
      return assignedServices.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === currentDateStr
      ).length
    }
    
    // For other views, return total services
    return assignedServices.length
  }, [assignedServices, date, view])
  
  // Get rendered services count and debug invisible services
  const renderedServicesCount = useMemo(() => {
    const count = countRenderedServices()
    
    // Debug invisible services for day view 
    if (view === Views.DAY && assignedServices?.length) {
      const currentDateStr = dayjs(date).format('YYYY-MM-DD')
      const nextDateStr = dayjs(date).add(1, 'day').format('YYYY-MM-DD')
      
      const visibleServices = assignedServices.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === currentDateStr
      )
      
      const invisibleServices = assignedServices.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') !== currentDateStr
      )
      
      const nextDayServices = assignedServices.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === nextDateStr
      )
      
      // Create a more detailed debugging object for invisible services
      const invisibleServicesDetails = invisibleServices.map(service => {
        // Get the shift this service belongs to
        const shift = assignedServices
          .filter(s => s.techId === service.techId)
          .sort((a, b) => new Date(a.start) - new Date(b.start))
        
        // Find first service in the shift on the current day (if any)
        const firstServiceInShift = shift.find(s => 
          dayjs(s.start).format('YYYY-MM-DD') === currentDateStr
        )
        
        return {
          id: service.id,
          company: service.company,
          start: service.start,
          startFormatted: dayjs(service.start).format('YYYY-MM-DD HH:mm'),
          end: service.end,
          endFormatted: dayjs(service.end).format('YYYY-MM-DD HH:mm'),
          techId: service.techId,
          // Reference to the shift's first service on current day (if exists)
          relatedShiftService: firstServiceInShift ? {
            id: firstServiceInShift.id,
            company: firstServiceInShift.company,
            start: firstServiceInShift.start,
            startFormatted: dayjs(firstServiceInShift.start).format('YYYY-MM-DD HH:mm')
          } : null
        }
      })
      
      // Log invisible services in a separate, more prominent log
      console.log('Invisible services:', invisibleServicesDetails)
      
      console.log('Services debug:', {
        currentDate: currentDateStr,
        nextDate: nextDateStr,
        initialTotal: totalServices,
        validServices: totalServices - unscheduledServices,
        unscheduledServices,
        assignedTotal: assignedServices.length,
        visible: visibleServices.length,
        invisible: invisibleServices.length,
        nextDay: nextDayServices.length
      })
    }
    
    return count
  }, [countRenderedServices, assignedServices, date, view, lastUpdateTime, totalServices, unscheduledServices])

  // Create custom toolbar component
  const customToolbar = useCallback(
    toolbar => {
      const validServices = totalServices - unscheduledServices
      const renderedServices = renderedServicesCount
      const notVisibleCount = validServices - renderedServices
      
      const label = (
        <>
          {toolbar.label}
          {!isScheduling && totalServices > 0 && (
            <span className="ml-10 text-gray-500">
              {`${validServices}/${totalServices} valid, ${renderedServices} visible ${notVisibleCount > 0 ? `(${notVisibleCount} on next day)` : ''}`}
            </span>
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
    [isScheduling, totalServices, unscheduledServices, renderedServicesCount, view]
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
