import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useEnforcement } from '@/app/hooks/useEnforcement'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

const BATCH_SIZE = 100 // Adjust this value based on performance
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

const mapClusterToTech = (service, clusterNum) => {
  // Map cluster numbers to tech names based on the original tech if enforced
  if (service.tech?.enforced) {
    return {
      id: service.tech.code,
      title: service.tech.name,
    }
  }

  // Otherwise use generic tech numbers
  return {
    id: `Tech ${clusterNum + 1}`,
    title: `Tech ${clusterNum + 1}`,
  }
}

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
  const progressRef = useRef(0)

  const dateRange = useMemo(
    () => ({
      start: dayjs(currentViewRange.start).startOf('day').toISOString(),
      end: dayjs(currentViewRange.end).endOf('day').toISOString(),
    }),
    [currentViewRange],
  )

  const debouncedSetProgress = useCallback(
    debounce(value => {
      setProgress(value)
    }, PROGRESS_UPDATE_INTERVAL),
    [],
  )

  const processDataBatch = useCallback(startIndex => {
    const { clusteredServices } = dataRef.current
    const endIndex = Math.min(startIndex + BATCH_SIZE, clusteredServices.length)

    const newAssignedServices = clusteredServices.slice(startIndex, endIndex).map(service => {
      const tech = mapClusterToTech(service, service.cluster)
      return {
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: tech.id,
        title: `${service.company} - ${tech.title}`,
      }
    })

    setResult(prevResult => ({
      ...prevResult,
      assignedServices: [...prevResult.assignedServices, ...newAssignedServices],
    }))

    if (endIndex < clusteredServices.length) {
      setTimeout(() => processDataBatch(endIndex), 0)
    } else {
      // Process resources (techs)
      const techSet = new Set(
        clusteredServices.map(service => {
          const tech = mapClusterToTech(service, service.cluster)
          return tech.id
        }),
      )

      const resources = Array.from(techSet)
        .map(techId => ({ id: techId, title: techId }))
        .sort((a, b) => {
          const aIsGeneric = a.id.startsWith('Tech ')
          const bIsGeneric = b.id.startsWith('Tech ')
          if (aIsGeneric !== bIsGeneric) return aIsGeneric ? -1 : 1
          return aIsGeneric
            ? Number.parseInt(a.id.split(' ')[1], 10) - Number.parseInt(b.id.split(' ')[1], 10)
            : a.id.localeCompare(b.id)
        })

      setResult(prevResult => ({
        ...prevResult,
        resources,
        filteredUnassignedServices: [],
      }))

      setLoading(false)
      setStatus('')
    }
  }, [])

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    setProgress(0)
    progressRef.current = 0
    setStatus('Initializing...')

    const eventSource = new EventSource(
      `/api/clustered-schedule?start=${dateRange.start}&end=${dateRange.end}`,
    )

    eventSource.onmessage = event => {
      const data = JSON.parse(event.data)
      if (data.type === 'progress') {
        const newProgress = data.data
        progressRef.current = newProgress
        if (newProgress === 0 || newProgress === 1) {
          // Immediately update for first and last progress
          setProgress(newProgress)
        } else {
          debouncedSetProgress(newProgress)
        }
        setStatus('Scheduling...')
      } else if (data.type === 'result') {
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
  }, [dateRange, processDataBatch, debouncedSetProgress])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  const allServices = useMemo(() => {
    return [...result.assignedServices, ...result.filteredUnassignedServices]
  }, [result])

  const { updateServiceEnforcement, updateAllServicesEnforcement, allServicesEnforced } =
    useEnforcement(allServices, fetchSchedule)

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
