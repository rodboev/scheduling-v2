import { useState, useEffect, useCallback, useRef } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { generateEventsForDateRange } from '@/app/utils/eventGeneration'
import { scheduleEvents } from '@/app/utils/scheduler'

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

      const { scheduledEvents, unscheduledEvents, techSchedules } = await scheduleEvents(
        { events: rawEvents, visibleStart, visibleEnd }, // Changed generatedEvents to rawEvents
        setProgress,
      )

      const allocatedEvents = Object.entries(techSchedules).flatMap(([techId, events]) =>
        events.map((event) => ({
          ...event,
          resourceId: techId,
        })),
      )

      const techCodes = new Set(allocatedEvents.map((event) => event.tech.code))

      const sortResources = (resources) => {
        return resources.sort((a, b) => {
          const aIsGeneric = !techCodes.has(a.id)
          const bIsGeneric = !techCodes.has(b.id)

          if (aIsGeneric && !bIsGeneric) return -1
          if (!aIsGeneric && bIsGeneric) return 1
          if (aIsGeneric && bIsGeneric) {
            return parseInt(a.id.split(' ')[1]) - parseInt(b.id.split(' ')[1])
          }
          return a.id.localeCompare(b.id)
        })
      }

      const resources = sortResources(
        Object.keys(techSchedules).map((techId) => ({
          id: techId,
          title: techId,
        })),
      )

      const filteredUnallocatedEvents = unscheduledEvents.filter((event) =>
        dayjs(event.start).isBetween(visibleStart, visibleEnd, null, '[]'),
      )

      const allServiceSetupsEnforced =
        allocatedEvents.length > 0 &&
        allocatedEvents.every((event) => enforcedServiceSetups[event.id.split('-')[0]])

      setResult({
        allocatedEvents,
        resources,
        filteredUnallocatedEvents,
        allServiceSetupsEnforced,
      })
      setLoading(false)
    }

    scheduleEventsAsync()

    // Set up an interval to update the progress state
    const intervalId = setInterval(() => {
      setProgress(progressRef.current)
    }, 100) // Update every 100ms

    // Clean up the interval when the effect is cleaned up
    return () => clearInterval(intervalId)
  }, [serviceSetups, currentViewRange, enforcedServiceSetups, updateProgress])

  return { ...result, isScheduling: loading, schedulingProgress: progress }
}
