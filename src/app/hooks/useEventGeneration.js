import { useState, useEffect, useCallback, useRef } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { scheduleEvents } from '@/app/utils/scheduler'
import { parseTime, parseTimeRange } from '@/app/utils/timeRange'

export function useEventGeneration(serviceSetups, currentViewRange, enforcedServiceSetups) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState({
    allocatedEvents: [],
    resources: [],
    filteredUnallocatedEvents: [],
    allServiceSetupsEnforced: false,
  })

  const progressRef = useRef(0)

  const updateProgress = useCallback((newProgress) => {
    progressRef.current = newProgress
    // Force a re-render
    setProgress(newProgress)
  }, [])

  // Create a stable onProgress function
  const onProgress = useCallback(
    (newProgress) => {
      updateProgress(newProgress)
    },
    [updateProgress],
  )

  function generateEventsForDateRange(setup, startDate, endDate) {
    const events = []
    const start = dayjs(startDate)
    const end = dayjs(endDate)

    for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
      if (shouldEventOccur(setup.schedule.string, date)) {
        const baseEvent = {
          ...setup,
          id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
          date: date.toDate(),
        }

        if (setup.time.enforced) {
          events.push({
            ...baseEvent,
            start: date.add(parseTime(setup.time.preferred), 'second').toDate(),
            end: date
              .add(parseTime(setup.time.preferred) + setup.time.duration * 60, 'second')
              .toDate(),
          })
        }
        else {
          const [rangeStart, rangeEnd] = parseTimeRange(
            setup.time.originalRange,
            setup.time.duration,
          )
          events.push({
            ...baseEvent,
            start: date.add(rangeStart, 'second').toDate(),
            end: date.add(rangeEnd, 'second').toDate(),
          })
        }

        // Ensure the tech.enforced property is carried over
        events[events.length - 1].tech.enforced = setup.tech.enforced
      }
    }

    return events.map((event) => {
      let eventEnd = dayjs(event.end)
      if (eventEnd.isBefore(event.start)) {
        // If the end time is before the start time, it means the event spans past midnight
        eventEnd = eventEnd.add(1, 'day')
      }
      return {
        ...event,
        end: eventEnd.toDate(),
      }
    })
  }

  function shouldEventOccur(scheduleString, date) {
    const dayOfYear = date.dayOfYear()
    const scheduleIndex = dayOfYear
    const shouldOccur = scheduleString[scheduleIndex] === '1'
    return shouldOccur
  }

  useEffect(() => {
    if (!serviceSetups || !currentViewRange) {
      return
    }

    setLoading(true)
    setProgress(0)
    progressRef.current = 0

    const scheduleEventsAsync = async () => {
      const visibleStart = dayjs(currentViewRange.start).startOf('day')
      const visibleEnd = dayjs(currentViewRange.end).endOf('day')

      const rawEvents = serviceSetups.flatMap((setup) => {
        const isEnforced = enforcedServiceSetups[setup.id] ?? setup.tech.enforced
        return generateEventsForDateRange(
          { ...setup, tech: { ...setup.tech, enforced: isEnforced } },
          visibleStart,
          visibleEnd,
        )
      })

      // Log the setup.id's that occur within the date range
      const occurringSetupIds = [...new Set(rawEvents.map((event) => event.id.split('-')[0]))]
      console.log(`Scheduling ${occurringSetupIds.length} setups:`, occurringSetupIds.join(','))

      const { scheduledEvents, unscheduledEvents, nextGenericTechId } = await scheduleEvents(
        { events: rawEvents, visibleStart, visibleEnd },
        onProgress,
      )

      // Create resources from scheduledEvents
      const techSet = new Set(scheduledEvents.map((event) => event.resourceId))
      const resources = Array.from(techSet)
        .map((techId) => ({
          id: techId,
          title: techId,
        }))
        .sort((a, b) => {
          const aIsGeneric = a.id.startsWith('Tech ')
          const bIsGeneric = b.id.startsWith('Tech ')
          if (aIsGeneric && !bIsGeneric) return -1
          if (!aIsGeneric && bIsGeneric) return 1
          if (aIsGeneric && bIsGeneric) {
            return parseInt(a.id.split(' ')[1]) - parseInt(b.id.split(' ')[1])
          }
          return a.id.localeCompare(b.id)
        })

      const allServiceSetupsEnforced =
        scheduledEvents.length > 0 &&
        scheduledEvents.every((event) => enforcedServiceSetups[event.id.split('-')[0]])

      setResult({
        allocatedEvents: scheduledEvents.map((event) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
        })),
        resources,
        filteredUnallocatedEvents: unscheduledEvents.map((event) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
        })),
        allServiceSetupsEnforced,
      })
      setLoading(false)
    }

    scheduleEventsAsync()

    const intervalId = setInterval(() => {
      setProgress(progressRef.current)
    }, 100) // Update every 100ms

    // Clean up the interval when the effect is cleaned up
    return () => clearInterval(intervalId)
  }, [serviceSetups, currentViewRange, enforcedServiceSetups, updateProgress, onProgress])

  return { ...result, isScheduling: loading, schedulingProgress: progress }
}
