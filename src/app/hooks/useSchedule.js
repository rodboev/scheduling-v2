import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export function useSchedule(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    filteredUnassignedServices: [],
  })
  const renderStartTime = useRef(null)
  const processingStartTime = useRef(null)

  const dateRange = useMemo(
    () => ({
      start: dayjs(currentViewRange.start).startOf('day').toISOString(),
      end: dayjs(currentViewRange.end).endOf('day').toISOString(),
    }),
    [currentViewRange],
  )

  const processScheduleData = useCallback(data => {
    const { scheduledServices, unassignedServices } = data

    console.log('Start processing schedule data')
    processingStartTime.current = performance.now()

    const formattedScheduledServices = scheduledServices.map(service => ({
      ...service,
      start: new Date(service.start),
      end: new Date(service.end),
    }))

    const techSet = new Set(
      formattedScheduledServices.map(service => service.resourceId),
    )
    const resources = Array.from(techSet)
      .map(techId => ({ id: techId, title: techId }))
      .sort((a, b) => {
        const aIsGeneric = a.id.startsWith('Tech ')
        const bIsGeneric = b.id.startsWith('Tech ')
        if (aIsGeneric !== bIsGeneric) return aIsGeneric ? -1 : 1
        return aIsGeneric
          ? parseInt(a.id.split(' ')[1]) - parseInt(b.id.split(' ')[1])
          : a.id.localeCompare(b.id)
      })

    const filteredUnassignedServices = unassignedServices.map(service => ({
      ...service,
      start: new Date(service.start),
      end: new Date(service.end),
    }))

    setResult({
      assignedServices: formattedScheduledServices,
      resources,
      filteredUnassignedServices,
    })

    const processingEndTime = performance.now()
    console.log(
      `Data processing took ${processingEndTime - processingStartTime.current} ms`,
    )

    renderStartTime.current = performance.now()
    setLoading(false)
  }, [])

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    setProgress(0)
    setStatus('Initializing...')

    const eventSource = new EventSource(
      `/api/schedule?start=${dateRange.start}&end=${dateRange.end}`,
    )

    eventSource.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.progress !== undefined) {
        setProgress(data.progress)
        setStatus('Scheduling...')
      } else if (data.scheduledServices && data.unassignedServices) {
        setStatus('Rendering...')
        // Introduce a slight delay before processing data
        setTimeout(() => {
          processScheduleData(data)
        }, 10)
        eventSource.close()
      }
    }

    eventSource.onerror = error => {
      console.error('EventSource failed:', error)
      eventSource.close()
      setLoading(false)
      setStatus('Error occurred')
    }
  }, [dateRange, processScheduleData])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  useEffect(() => {
    if (!loading && renderStartTime.current) {
      const renderEndTime = performance.now()
      console.log(
        `Rendering took ${renderEndTime - renderStartTime.current} ms`,
      )
      renderStartTime.current = null
      setStatus('')
    }
  }, [loading])

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
    schedulingStatus: status,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: fetchSchedule,
  }
}
