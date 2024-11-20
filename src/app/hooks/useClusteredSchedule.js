import { useState, useEffect, useMemo, useCallback } from 'react'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

const PROGRESS_UPDATE_INTERVAL = 10 // Update progress every 10ms

function debounce(func, wait, immediate = false) {
  let timeout
  return function executedFunction(...args) {
    const context = this
    const later = () => {
      timeout = null
      if (!immediate) func.apply(context, args)
    }
    const callNow = immediate && !timeout
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
    if (callNow) func.apply(context, args)
  }
}

export function useSchedule(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
    unassignedServices: []
  })

  const debouncedSetProgress = useCallback(
    debounce(value => {
      setProgress(value)
    }, PROGRESS_UPDATE_INTERVAL),
    []
  )

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    setProgress(0)
    setStatus('Initializing...')

    const params = new URLSearchParams({
      start: dayjs(currentViewRange.start).toISOString(),
      end: dayjs(currentViewRange.end).toISOString()
    })

    const eventSource = new EventSource(
      `/api/clustered-schedule?${params.toString()}`
    )

    eventSource.onmessage = event => {
      const data = JSON.parse(event.data)
      
      if (data.type === 'progress') {
        const newProgress = data.data
        if (newProgress === 0 || newProgress === 1) {
          setProgress(newProgress)
        } else {
          debouncedSetProgress(newProgress)
        }
        setStatus('Scheduling...')
      } else if (data.type === 'result') {
        eventSource.close()
        
        // Convert services to calendar events while preserving original structure
        const processedServices = (data.clusteredServices || []).map(service => ({
          ...service, // Keep all original service data
          // Add calendar-specific fields
          id: service.id,
          title: `${service.company} - ${service.tech.name}`,
          start: new Date(service.start),
          end: new Date(service.end),
          resourceId: `Tech ${service.cluster + 1}`,
          enforced: service.tech.enforced
        }))

        // Create unique tech resources
        const techs = new Set(data.clusteredServices?.map(s => s.cluster) || [])
        const resources = Array.from(techs).sort((a, b) => a - b).map(techNum => ({
          id: `Tech ${techNum + 1}`,
          title: `Tech ${techNum + 1}`
        }))

        setResult({
          assignedServices: processedServices,
          resources,
          unassignedServices: []
        })
        setLoading(false)
        setStatus('')
      }
    }

    eventSource.onerror = error => {
      console.error('EventSource failed:', error)
      eventSource.close()
      setLoading(false)
      setStatus('Error occurred')
    }
  }, [currentViewRange, debouncedSetProgress])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  const allServices = useMemo(() => {
    return [...result.assignedServices, ...result.unassignedServices]
  }, [result])

  const {
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced
  } = useEnforcement(allServices, fetchSchedule)

  return {
    ...result,
    isScheduling: loading,
    schedulingProgress: progress,
    schedulingStatus: status,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: fetchSchedule
  }
}
