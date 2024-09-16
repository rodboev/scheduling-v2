import { useState, useEffect, useMemo } from 'react'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export function useSchedule(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    filteredUnassignedServices: [],
  })

  const dateRange = useMemo(
    () => ({
      start: dayjs(currentViewRange.start).startOf('day').toISOString(),
      end: dayjs(currentViewRange.end).endOf('day').toISOString(),
    }),
    [currentViewRange],
  )

  const fetchSchedule = async () => {
    setLoading(true)
    setProgress(0)

    const eventSource = new EventSource(
      `/api/schedule?start=${dateRange.start}&end=${dateRange.end}`,
    )

    eventSource.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.progress !== undefined) {
        setProgress(data.progress)
      } else if (data.scheduledServices && data.unassignedServices) {
        processScheduleData(data)
        eventSource.close()
      }
    }

    eventSource.onerror = error => {
      console.error('EventSource failed:', error)
      eventSource.close()
      setLoading(false)
    }
  }

  const processScheduleData = data => {
    const { scheduledServices, unassignedServices } = data

    const formattedScheduledServices = scheduledServices.map(service => ({
      ...service,
      start: new Date(service.start),
      end: new Date(service.end),
    }))

    const techSet = new Set(
      formattedScheduledServices.map(service => service.resourceId),
    )
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
      filteredUnassignedServices: unassignedServices.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
      })),
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchSchedule()
  }, [dateRange])

  const allServices = useMemo(() => {
    return [...result.assignedServices, ...result.filteredUnassignedServices]
  }, [result])

  const {
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    enforcedServicesList,
    allServicesEnforced,
  } = useEnforcement(allServices, fetchSchedule)

  return {
    ...result,
    isScheduling: loading,
    schedulingProgress: progress,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: fetchSchedule,
  }
}
