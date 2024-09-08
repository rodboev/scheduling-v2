import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { scheduleServices } from '@/app/utils/scheduler'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { useEnforcement } from './useEnforcement'

export function useServices(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    filteredUnassignedServices: [],
  })
  const progressRef = useRef(0)

  const dateRange = useMemo(
    () => ({
      start: dayjs(currentViewRange.start).startOf('day').toISOString(),
      end: dayjs(currentViewRange.end).endOf('day').toISOString(),
    }),
    [currentViewRange],
  )

  const { data: services, isLoading: isServicesLoading } = useQuery({
    queryKey: ['services', dateRange],
    queryFn: () =>
      axios
        .get('/api/services', {
          params: {
            start: dateRange.start,
            end: dateRange.end,
          },
        })
        .then(res => res.data.map(({ schedule, ...rest }) => rest)),
    enabled: !!dateRange.start && !!dateRange.end,
  })

  const {
    enforcedServicesList,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
  } = useEnforcement(services || [])

  const updateProgress = useCallback(newProgress => {
    progressRef.current = newProgress
    setProgress(newProgress)
  }, [])

  const onProgress = useCallback(
    newProgress => {
      updateProgress(newProgress)
    },
    [updateProgress],
  )

  useEffect(() => {
    if (!enforcedServicesList || isServicesLoading) {
      return
    }

    setLoading(true)
    setProgress(0)
    progressRef.current = 0

    const scheduleServicesAsync = async () => {
      const { scheduledServices, unscheduledServices } = await scheduleServices(
        {
          services: enforcedServicesList,
          visibleStart: new Date(dateRange.start),
          visibleEnd: new Date(dateRange.end),
        },
        onProgress,
      )

      const formattedScheduledServices = scheduledServices.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
      }))

      const techSet = new Set(formattedScheduledServices.map(service => service.resourceId))
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

      setResult({
        assignedServices: formattedScheduledServices,
        resources,
        filteredUnassignedServices: unscheduledServices.map(service => ({
          ...service,
          start: new Date(service.start),
          end: new Date(service.end),
        })),
      })
      setLoading(false)
    }

    scheduleServicesAsync()
  }, [enforcedServicesList, dateRange, onProgress])

  return {
    ...result,
    isScheduling: loading || isServicesLoading,
    schedulingProgress: progress,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
  }
}
