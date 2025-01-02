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

export function useSchedule(currentViewRange) {
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  const [result, setResult] = useState({
    assignedServices: [],
    resources: [],
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
    const { scheduledServices, unassignedServices } = dataRef.current
    const totalServices = scheduledServices?.length || 0

    // Update progress based on how many services we've processed
    const newProgress = Math.min(startIndex / totalServices, 0.9) // Cap at 90% until final render
    setProgress(newProgress)
    setStatus('Rendering services...')

    console.log('Processing data batch:', {
      startIndex,
      scheduledServices: scheduledServices?.length,
      unassignedServices: unassignedServices?.length,
      progress: Math.round(newProgress * 100) + '%',
      sample: scheduledServices?.[0],
    })

    const endIndex = Math.min(startIndex + BATCH_SIZE, scheduledServices.length)

    const newAssignedServices = scheduledServices.slice(startIndex, endIndex).map(service => {
      // Ensure all required fields exist
      const tech = service.tech || {}
      const location = service.location || {}
      const time = service.time || {}
      const comments = service.comments || {}
      const route = service.route || {}

      const processedService = {
        ...service,
        // Calendar fields
        id: service.id,
        title: `${service.company} - ${service.techId || 'Unassigned'}`,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: service.techId || 'Unassigned',
        // Service component fields
        tech: {
          code: tech.code || 'Unassigned',
          name: tech.name || 'Unassigned',
          enforced: tech.enforced || false,
        },
        company: service.company || '',
        location: {
          id: location.id || '',
          code: location.code || '',
          address: location.address || '',
          address2: location.address2 || '',
        },
        time: {
          range: [
            time.range?.[0] ? new Date(time.range[0]) : null,
            time.range?.[1] ? new Date(time.range[1]) : null,
          ],
          preferred: time.preferred ? new Date(time.preferred) : null,
          duration: time.duration || 0,
          meta: time.meta || {},
        },
        comments: {
          serviceSetup: comments.serviceSetup || '',
          location: comments.location || '',
        },
        route: {
          time: route.time || [],
          days: route.days || '',
        },
      }

      if (startIndex === 0) {
        console.log('Sample processed service:', processedService)
      }

      return processedService
    })

    setResult(prevResult => {
      const newResult = {
        ...prevResult,
        assignedServices: [...prevResult.assignedServices, ...newAssignedServices],
      }
      return newResult
    })

    if (endIndex < scheduledServices.length) {
      // Continue processing next batch
      setTimeout(() => processDataBatch(endIndex), 0)
    } else {
      // Create resources from assigned services only
      const techSet = new Set(scheduledServices.map(service => service.techId || 'Unassigned'))

      const resources = Array.from(techSet)
        .map(techId => ({ id: techId, title: techId }))
        .sort((a, b) => {
          if (a.id === 'Unassigned') return 1
          if (b.id === 'Unassigned') return -1
          const aNum = Number.parseInt(a.id.split(' ')[1], 10)
          const bNum = Number.parseInt(b.id.split(' ')[1], 10)
          return aNum - bNum
        })

      setResult(prevResult => ({
        ...prevResult,
        resources,
      }))

      // Final progress update
      setProgress(1)
      setStatus('Complete')
      setLoading(false)
    }
  }, [])

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    setProgress(0)
    setStatus('Initializing...')

    try {
      console.log('Fetching schedule for date range:', dateRange)
      setStatus('Fetching services...')
      setProgress(0.1)

      const response = await fetch(`/api/schedule?start=${dateRange.start}&end=${dateRange.end}`)

      if (!response.ok) {
        throw new Error('Failed to fetch schedule')
      }

      setProgress(0.3)
      setStatus('Processing data...')

      const data = await response.json()
      console.log('Schedule API response:', {
        scheduledServices: data.scheduledServices?.length,
        unassignedServices: data.unassignedServices?.length,
        sample: data.scheduledServices?.[0],
      })

      setProgress(0.4)
      setStatus('Preparing services...')

      dataRef.current = {
        scheduledServices: data.scheduledServices || [],
        unassignedServices: data.unassignedServices || [],
      }

      setStatus('Rendering...')
      setResult({
        assignedServices: [],
        resources: [],
      })

      // Start processing batches
      processDataBatch(0)
    } catch (error) {
      console.error('Error fetching schedule:', error)
      setStatus('Error occurred')
      setLoading(false)
    }
  }, [dateRange, processDataBatch])

  useEffect(() => {
    fetchSchedule()
  }, [fetchSchedule])

  const allServices = useMemo(() => {
    return [...result.assignedServices]
  }, [result])

  const { updateServiceEnforcement, updateAllServicesEnforcement, allServicesEnforced } =
    useEnforcement(allServices, fetchSchedule)

  return {
    assignedServices: result.assignedServices,
    resources: result.resources,
    isScheduling: loading,
    schedulingProgress: progress,
    schedulingStatus: status,
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: fetchSchedule,
  }
}
