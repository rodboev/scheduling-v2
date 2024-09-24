import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

const BATCH_SIZE = 100 // Adjust this value based on performance

export function useSchedule(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    filteredUnassignedServices: [],
  })
  const dataRef = useRef(null)

  const dateRange = useMemo(
    () => ({
      start: dayjs(currentViewRange.start).startOf('day').toISOString(),
      end: dayjs(currentViewRange.end).endOf('day').toISOString(),
    }),
    [currentViewRange],
  )

  const processDataBatch = useCallback(startIndex => {
    const { scheduledServices, unassignedServices } = dataRef.current
    const endIndex = Math.min(startIndex + BATCH_SIZE, scheduledServices.length)

    const newAssignedServices = scheduledServices
      .slice(startIndex, endIndex)
      .map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
      }))

    setResult(prevResult => ({
      ...prevResult,
      assignedServices: [
        ...prevResult.assignedServices,
        ...newAssignedServices,
      ],
    }))

    if (endIndex < scheduledServices.length) {
      setTimeout(() => processDataBatch(endIndex), 0)
    } else {
      // Process unassigned services and resources
      const filteredUnassignedServices = unassignedServices.map(service => ({
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
      }))

      const techSet = new Set(
        scheduledServices.map(service => service.resourceId),
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

      setResult(prevResult => ({
        ...prevResult,
        filteredUnassignedServices,
        resources,
      }))

      setLoading(false)
      setStatus('')
    }
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
        setProgress(data.progress) // This value is now between 0 and 1
        setStatus('Scheduling...')
      } else if (data.scheduledServices && data.unassignedServices) {
        eventSource.close()
        dataRef.current = data
        setStatus('Rendering...')
        setResult({
          assignedServices: [],
          resources: [],
          filteredUnassignedServices: [],
        })
        processDataBatch(0)
      }
    }

    eventSource.onerror = error => {
      console.error('EventSource failed:', error)
      eventSource.close()
      setLoading(false)
      setStatus('Error occurred')
    }
  }, [dateRange, processDataBatch])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  const allServices = useMemo(() => {
    return [...result.assignedServices, ...result.filteredUnassignedServices]
  }, [result])

  const {
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
  } = useEnforcement(allServices, fetchSchedule)

  return {
    ...result,
    isScheduling: loading,
    schedulingProgress: progress, // This is now a value between 0 and 1
    schedulingStatus: status,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: fetchSchedule,
  }
}
