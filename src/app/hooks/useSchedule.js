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
    const { scheduledServices, unassignedServices } = dataRef.current
    console.log('Processing data batch:', {
      startIndex,
      scheduledServices: scheduledServices?.length,
      unassignedServices: unassignedServices?.length,
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
        title: `${service.company} - ${tech.name || 'Unassigned'}`,
        start: new Date(service.start),
        end: new Date(service.end),
        resourceId: tech.code || `Tech ${(service.cluster || 0) + 1}`,
        // Service component fields
        tech: {
          code: tech.code || `Tech ${(service.cluster || 0) + 1}`,
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
      console.log('Updated result:', {
        assignedServices: newResult.assignedServices.length,
        resources: newResult.resources.length,
        sample: newResult.assignedServices[0],
      })
      return newResult
    })

    if (endIndex < scheduledServices.length) {
      setTimeout(() => processDataBatch(endIndex), 0)
    } else {
      // Process unassigned services with the same structure
      const filteredUnassignedServices = unassignedServices.map(service => {
        const tech = service.tech || {}
        const location = service.location || {}
        const time = service.time || {}
        const comments = service.comments || {}
        const route = service.route || {}

        return {
          ...service,
          id: service.id,
          title: `${service.company} - Unassigned`,
          start: new Date(service.start),
          end: new Date(service.end),
          resourceId: 'Unassigned',
          tech: {
            code: 'Unassigned',
            name: 'Unassigned',
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
      })

      // Create resources from both assigned and unassigned services
      const techSet = new Set([
        ...scheduledServices.map(
          service => service.tech?.code || `Tech ${(service.cluster || 0) + 1}`,
        ),
        'Unassigned',
      ])

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

      console.log('Final resources:', resources)

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

    try {
      console.log('Fetching schedule for date range:', dateRange)
      const response = await fetch(`/api/schedule?start=${dateRange.start}&end=${dateRange.end}`)

      if (!response.ok) {
        throw new Error('Failed to fetch schedule')
      }

      const data = await response.json()
      console.log('Schedule API response:', {
        scheduledServices: data.scheduledServices?.length,
        unassignedServices: data.unassignedServices?.length,
        sample: data.scheduledServices?.[0],
      })

      dataRef.current = {
        scheduledServices: data.scheduledServices || [],
        unassignedServices: data.unassignedServices || [],
      }

      setStatus('Rendering...')
      setResult({
        assignedServices: [],
        resources: [],
        filteredUnassignedServices: [],
      })
      processDataBatch(0)
    } catch (error) {
      console.error('Error fetching schedule:', error)
      setStatus('Error occurred')
    } finally {
      setLoading(false)
    }
  }, [dateRange, processDataBatch])

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
