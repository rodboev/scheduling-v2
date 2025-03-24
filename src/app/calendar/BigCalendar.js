'use client'

import EnforceSwitch from '@/app/calendar/EnforceSwitch'
import Header from '@/app/components/Header'
import Logo from '@/app/components/Logo'
import ProgressBar from '@/app/components/ProgressBar'
import Service from '@/app/components/Service'
import { Button } from '@/app/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
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
  const [techPercentage, setTechPercentage] = useState('100') // Default tech percentage

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
      
      // Calculate these directly to ensure accuracy
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
          originalService: service,
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
      
      // Get unscheduled services array from schedulingDetails and log it properly
      const unscheduledServicesArray = schedulingDetails?.unscheduledServices || []
      console.log('Unassigned services:', unscheduledServicesArray.length > 0 ? unscheduledServicesArray : 'None')
      console.log('Invisible services:', invisibleServicesDetails)
      
      // Count services directly from filtering the assignedServices
      const nextDayCount = assignedServices.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === nextDateStr
      ).length
      
      // Calculate valid services based on what's actually assigned
      const validServicesCount = assignedServices.length
      
      // Calculate total including unscheduled
      const totalServicesCount = validServicesCount + unscheduledServicesArray.length
      
      console.log('Services debug:', {
        currentDate: currentDateStr,
        nextDate: nextDateStr,
        initialTotal: totalServicesCount,
        validServices: validServicesCount,
        unscheduledCount: unscheduledServicesArray.length,
        assignedTotal: assignedServices.length,
        visible: visibleServices.length,
        invisible: invisibleServices.length,
        nextDay: nextDayServices.length,
        // Add check that invisible === invisible directly counted
        invisibleMatchesCount: invisibleServices.length === (assignedServices.length - visibleServices.length),
        // Check that next day count matches what's in invisibles
        nextDayMatchesInvisible: nextDayServices.length === nextDayCount
      })
    }
    
    return count
  }, [countRenderedServices, assignedServices, date, view, lastUpdateTime, totalServices, unscheduledServices])

  // Create custom toolbar component
  const customToolbar = useCallback(
    toolbar => {
      // Create a comprehensive debug log to help diagnose count mismatches
      console.log('DETAILED COUNT DEBUGGING:', {
        // Raw counts
        totalServices,
        assignedServicesLength: assignedServices?.length || 0,
        unscheduledServicesCount: schedulingDetails?.unscheduledServices?.length || 0,
        
        // Scheduling details from API
        schedulingDetailsTotal: schedulingDetails?.totalServices,
        schedulingDetailsValid: schedulingDetails?.validServices,
        schedulingDetailsInvalid: schedulingDetails?.invalidServices,
        
        // Directly calculated counts
        visibleCount: assignedServices?.filter(service => 
          dayjs(service.start).format('YYYY-MM-DD') === dayjs(date).format('YYYY-MM-DD')
        ).length || 0,
        nextDayCount: assignedServices?.filter(service => 
          dayjs(service.start).format('YYYY-MM-DD') === dayjs(date).add(1, 'day').format('YYYY-MM-DD')
        ).length || 0
      })
      
      // 1. Total Services = All services from the API (valid + invalid)
      const totalServicesCount = schedulingDetails?.totalServices || totalServices;
      
      // 2. Valid Services = Only those that passed validation and were sent to scheduler
      const validServicesCount = schedulingDetails?.validServices || assignedServices?.length || 0;
      
      // 3. Visible Services = Valid services visible in current day view
      const visibleServicesCount = assignedServices?.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === dayjs(date).format('YYYY-MM-DD')
      ).length || 0;
      
      // 4. Next Day Services = Valid services scheduled for next day (not visible in current day view)
      const nextDayCount = assignedServices?.filter(service => 
        dayjs(service.start).format('YYYY-MM-DD') === dayjs(date).add(1, 'day').format('YYYY-MM-DD')
      ).length || 0;
      
      // Verify the counts are consistent
      console.log('COUNT VERIFICATION:', {
        validEqualsAssigned: validServicesCount === assignedServices?.length,
        visiblePlusNextDayEqualsValid: (visibleServicesCount + nextDayCount) === validServicesCount,
        totalEqualsValidPlusInvalid: totalServicesCount === (validServicesCount + (schedulingDetails?.invalidServices || 0))
      });
      
      // Calculate unique tech counts
      const techCount = resources?.length || 0
      
      // Count unique original tech codes from service.tech.code
      const pestPacTechCodes = new Set()
      assignedServices?.forEach(service => {
        if (service.tech?.code) {
          pestPacTechCodes.add(service.tech.code)
        }
      })
      const pestPacTechCount = pestPacTechCodes.size
      
      // Calculate services coverage based on tech percentage
      const calculateServiceCoverage = () => {
        if (!resources || !assignedServices || resources.length === 0 || assignedServices.length === 0) {
          return { servicesCount: 0, servicesPercentage: 0 }
        }
        
        // 1. Count services per tech across all assigned services (not just visible ones)
        const techServicesMap = {}
        
        // Count all assigned services for the calculation, not just visible ones
        assignedServices.forEach(service => {
          if (service.techId) {
            techServicesMap[service.techId] = (techServicesMap[service.techId] || 0) + 1
          }
        })
        
        // 2. Sort techs by service count (most services first)
        const sortedTechs = Object.entries(techServicesMap)
          .sort((a, b) => b[1] - a[1])
          .map(([techId]) => techId)
        
        // 3. Take the specified percentage of techs
        const selectedPercentage = parseInt(techPercentage, 10)
        const techsToInclude = Math.max(1, Math.ceil((selectedPercentage / 100) * sortedTechs.length))
        const includedTechIds = sortedTechs.slice(0, techsToInclude)
        
        // 4. Count all services covered by the included techs (not just visible ones)
        const coveredServices = assignedServices.filter(service => 
          includedTechIds.includes(service.techId)
        )
        
        // 5. Calculate percentage of services covered
        const servicesCount = coveredServices.length
        const servicesPercentage = (servicesCount / assignedServices.length) * 100
        
        return { 
          servicesCount, 
          servicesPercentage: Math.round(servicesPercentage), 
          techsIncluded: techsToInclude 
        }
      }
      
      const { servicesCount, servicesPercentage, techsIncluded } = calculateServiceCoverage()
      
      const label = (
        <>
          {toolbar.label}
          {!isScheduling && totalServices > 0 && (
            <span className="ml-10 text-gray-500">
              {`${validServicesCount}/${totalServicesCount} valid, ${visibleServicesCount} visible ${nextDayCount > 0 ? `(${nextDayCount} on next day)` : ''}, in ${techCount} techs (${pestPacTechCount} in PestPac)`}
            </span>
          )}
        </>
      )
      
      // Create percentage options from 50% to 100% in 5% increments
      const percentageOptions = []
      for (let i = 50; i <= 100; i += 5) {
        percentageOptions.push(i.toString())
      }
      
      return (
        <div className="flex flex-col">
          <div className="rbc-toolbar">
            <span className="rbc-btn-group">
              <button type="button" onClick={() => toolbar.onNavigate('PREV')}>Back</button>
              <button type="button" onClick={() => toolbar.onNavigate('TODAY')}>Today</button>
              <button type="button" onClick={() => toolbar.onNavigate('NEXT')}>Next</button>
            </span>
            <span className="rbc-toolbar-label ml-20">
              {label}
              {!isScheduling && validServicesCount > 0 && (
                <div className="flex items-center justify-center text-gray-600 mt-1">
                  <span>
                    Of {validServicesCount} services, {servicesCount} ({servicesPercentage}%) can be serviced with 
                  </span>
                  <span className="mx-1">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button 
                          className="h-7 bg-white text-black border-2 border-blue-500 hover:bg-gray-100 hover:border-blue-600 px-2 inline-flex items-center space-x-1 rounded shadow-sm"
                          style={{ display: 'inline-flex', whiteSpace: 'nowrap' }}
                        >
                          <span>{techPercentage}%</span>
                          <svg 
                            className="h-3 w-3" 
                            xmlns="http://www.w3.org/2000/svg" 
                            viewBox="0 0 20 20" 
                            fill="currentColor" 
                            aria-hidden="true"
                          >
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-20 p-0 shadow-md">
                        <div className="flex flex-col">
                          {percentageOptions.map(percentage => (
                            <button
                              key={percentage}
                              className={`px-1 py-1 text-center text-sm hover:bg-gray-100 ${percentage === techPercentage ? 'bg-gray-100 font-medium' : ''}`}
                              onClick={() => setTechPercentage(percentage)}
                            >
                              {percentage}%
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </span>
                  <span>
                    {techsIncluded} techs
                  </span>
                </div>
              )}
            </span>
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
        </div>
      )
    },
    [isScheduling, totalServices, view, assignedServices, resources, schedulingDetails, date, techPercentage]
  )

  const calendarComponents = useMemo(
    () => ({
      event: eventComponent,
      toolbar: customToolbar,  // Add custom toolbar component
    }),
    [eventComponent, customToolbar]
  )

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
