import { useState, useEffect, useCallback, useRef } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { scheduleServices } from '@/app/utils/scheduler'
import { parseTime, parseTimeRange } from '@/app/utils/timeRange'

export function useServices(serviceSetups, currentViewRange, enforcedServices) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    filteredUnassignedServices: [],
    allServicesEnforced: false,
  })

  const progressRef = useRef(0)

  const updateProgress = useCallback(newProgress => {
    progressRef.current = newProgress
    // Force a re-render
    setProgress(newProgress)
  }, [])

  // Create a stable onProgress function
  const onProgress = useCallback(
    newProgress => {
      updateProgress(newProgress)
    },
    [updateProgress],
  )

  function createServicesForDateRange(setup, startDate, endDate) {
    const services = []
    const start = dayjs(startDate)
    const end = dayjs(endDate)

    for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
      if (shouldServiceOccur(setup.schedule.string, date)) {
        const baseService = {
          ...setup,
          id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
          date: date.toDate(),
        }

        if (setup.time.enforced) {
          services.push({
            ...baseService,
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
          services.push({
            ...baseService,
            start: date.add(rangeStart, 'second').toDate(),
            end: date.add(rangeEnd, 'second').toDate(),
          })
        }

        // Ensure the tech.enforced property is carried over
        services[services.length - 1].tech.enforced = setup.tech.enforced
      }
    }

    return services.map(service => {
      let serviceEnd = dayjs(service.end)
      if (serviceEnd.isBefore(service.start)) {
        // If the end time is before the start time, it means the service spans past midnight
        serviceEnd = serviceEnd.add(1, 'day')
      }
      return {
        ...service,
        end: serviceEnd.toDate(),
      }
    })
  }

  function shouldServiceOccur(scheduleString, date) {
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

    const scheduleServicesAsync = async () => {
      const visibleStart = dayjs(currentViewRange.start).startOf('day')
      const visibleEnd = dayjs(currentViewRange.end).endOf('day')

      const rawServices = serviceSetups.flatMap(setup => {
        const isEnforced = enforcedServices[setup.id] ?? setup.tech.enforced
        return createServicesForDateRange(
          { ...setup, tech: { ...setup.tech, enforced: isEnforced } },
          visibleStart,
          visibleEnd,
        )
      })

      // Log the setup.id's that occur within the date range
      const occurringSetupIds = [...new Set(rawServices.map(service => service.id.split('-')[0]))]
      console.log(`Scheduling ${occurringSetupIds.length} setups:`, occurringSetupIds.join(','))

      const { scheduledServices, unscheduledServices, nextGenericTechId } = await scheduleServices(
        { services: rawServices, visibleStart, visibleEnd },
        onProgress,
      )

      // Create resources from scheduledServices
      const techSet = new Set(scheduledServices.map(service => service.resourceId))
      const resources = Array.from(techSet)
        .map(techId => ({
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

      const allServicesEnforced =
        scheduledServices.length > 0 &&
        scheduledServices.every(service => enforcedServices[service.id.split('-')[0]])

      setResult({
        assignedServices: scheduledServices.map(service => ({
          ...service,
          start: new Date(service.start),
          end: new Date(service.end),
        })),
        resources,
        filteredUnassignedServices: unscheduledServices.map(service => ({
          ...service,
          start: new Date(service.start),
          end: new Date(service.end),
        })),
        allServicesEnforced,
      })
      setLoading(false)
    }

    scheduleServicesAsync()

    const intervalId = setInterval(() => {
      setProgress(progressRef.current)
    }, 100) // Update every 100ms

    // Clean up the interval when the effect is cleaned up
    return () => clearInterval(intervalId)
  }, [serviceSetups, currentViewRange, enforcedServices, updateProgress, onProgress])

  return { ...result, isScheduling: loading, schedulingProgress: progress }
}
