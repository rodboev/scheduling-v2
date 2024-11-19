import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { Views } from 'react-big-calendar'

function createDateRange(start, end) {
  return {
    start: dayjs(start).toDate(),
    end: dayjs(end).toDate()
  }
}

async function fetchClusteredSchedule(start, end) {
  const response = await fetch(`/api/cluster-single?start=${start}&end=${end}`)
  if (!response.ok) throw new Error('Failed to fetch schedule')
  return response.json()
}

export function useClusteredCalendar(defaultDate = new Date()) {
  const [date, setDate] = useState(defaultDate)
  const [view, setView] = useState(Views.WEEK)
  const [currentViewRange, setCurrentViewRange] = useState(() => {
    return createDateRange(
      dayjs(defaultDate).startOf('week').toDate(),
      dayjs(defaultDate).endOf('week').toDate(),
    )
  })

  const [allServicesEnforced, setAllServicesEnforced] = useState(false)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['clusteredSchedule', currentViewRange.start, currentViewRange.end],
    queryFn: () => fetchClusteredSchedule(
      currentViewRange.start.toISOString(),
      currentViewRange.end.toISOString()
    ),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Transform clustered services into calendar events
  const assignedServices = useMemo(() => {
    if (!data?.clusteredServices) return []
    
    return data.clusteredServices.map(service => ({
      id: service.id,
      title: service.company,
      start: new Date(service.start),
      end: new Date(service.end),
      resourceId: `Cluster ${service.cluster + 1}`,
      tech: service.tech,
      location: service.location,
      comments: service.comments,
      enforced: service.tech.enforced,
    }))
  }, [data?.clusteredServices])

  // Create resources from clusters
  const resources = useMemo(() => {
    if (!data?.clusteringInfo?.totalClusters) return []
    
    return Array.from({ length: data.clusteringInfo.totalClusters }, (_, i) => ({
      id: `Cluster ${i + 1}`,
      title: `Cluster ${i + 1}`
    }))
  }, [data?.clusteringInfo?.totalClusters])

  const handleView = useCallback(newView => {
    setView(newView)
    
    if (newView === Views.DAY) {
      setCurrentViewRange(createDateRange(date, date))
    } else if (newView === Views.WEEK) {
      setCurrentViewRange(createDateRange(
        dayjs(date).startOf('week').toDate(),
        dayjs(date).endOf('week').toDate()
      ))
    } else if (newView === Views.MONTH) {
      setCurrentViewRange(createDateRange(
        dayjs(date).startOf('month').toDate(),
        dayjs(date).endOf('month').toDate()
      ))
    }
  }, [date])

  const handleNavigate = useCallback((newDate, viewType) => {
    setDate(newDate)
    
    if (view === Views.DAY) {
      setCurrentViewRange(createDateRange(newDate, newDate))
    } else if (view === Views.WEEK) {
      setCurrentViewRange(createDateRange(
        dayjs(newDate).startOf('week').toDate(),
        dayjs(newDate).endOf('week').toDate()
      ))
    } else if (view === Views.MONTH) {
      setCurrentViewRange(createDateRange(
        dayjs(newDate).startOf('month').toDate(),
        dayjs(newDate).endOf('month').toDate()
      ))
    }
  }, [view])

  const handleRangeChange = useCallback(range => {
    const [start, end] = Array.isArray(range)
      ? [range[0], range[range.length - 1]]
      : [range.start, range.end]
    setCurrentViewRange(createDateRange(start, end))
  }, [])

  const updateServiceEnforcement = useCallback((serviceId, enforced) => {
    // Implementation for single service enforcement update
  }, [])

  const updateAllServicesEnforcement = useCallback(enforced => {
    setAllServicesEnforced(enforced)
  }, [])

  return {
    date,
    view,
    currentViewRange,
    assignedServices,
    resources,
    unassignedServices: [], // Implement if needed
    isScheduling: isLoading,
    schedulingProgress: data?.clusteringInfo?.performanceDuration || 0,
    schedulingStatus: error ? 'error' : isLoading ? 'scheduling' : 'complete',
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    allServicesEnforced,
    refetchSchedule: refetch,
    handleView,
    handleNavigate,
    handleRangeChange,
  }
} 