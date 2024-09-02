// src/app/hooks/useEventGeneration.js

import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { generateEventsForDateRange } from '@/app/utils/eventGeneration'
import { scheduleEvents } from '@/app/utils/scheduler-v6'

export function useEventGeneration(serviceSetups, currentViewRange, enforcedServiceSetups) {
  if (!serviceSetups || !currentViewRange) {
    return {
      allocatedEvents: [],
      resources: [],
      filteredUnallocatedEvents: [],
      allServiceSetupsEnforced: false,
    }
  }

  const visibleStart = dayjs(currentViewRange.start).startOf('day')
  const visibleEnd = dayjs(currentViewRange.end).endOf('day')

  const rawEvents = serviceSetups.flatMap((setup) => {
    const isEnforced = enforcedServiceSetups[setup.id] ?? setup.tech.enforced
    return generateEventsForDateRange(
      { ...setup, tech: { ...setup.tech, enforced: isEnforced } },
      visibleStart,
      visibleEnd,
    )
  })

  // const { scheduledEvents, unscheduledEvents } = scheduleEvents(rawEvents, 'improved')
  const { scheduledEvents, unscheduledEvents } = scheduleEvents({
    events: rawEvents,
    resources: [],
    visibleStart,
    visibleEnd,
  })

  const usedResourceIds = [...new Set(scheduledEvents.map((event) => event.resourceId))]
  const techCodes = new Set(scheduledEvents.map((event) => event.tech.code))

  const sortResources = (resources) => {
    return resources.sort((a, b) => {
      const aIsGeneric = !techCodes.has(a.id)
      const bIsGeneric = !techCodes.has(b.id)

      if (aIsGeneric && !bIsGeneric) return -1
      if (!aIsGeneric && bIsGeneric) return 1
      if (aIsGeneric && bIsGeneric) {
        // Assuming generic resources are numbered (e.g., "Tech 1", "Tech 2")
        return parseInt(a.id.split(' ')[1]) - parseInt(b.id.split(' ')[1])
      }
      return a.id.localeCompare(b.id)
    })
  }

  const resources = sortResources(
    usedResourceIds.map((techId) => ({
      id: techId,
      title: techId,
    })),
  )

  const filteredUnallocatedEvents = Array.isArray(unscheduledEvents)
    ? unscheduledEvents.filter((event) =>
        dayjs(event.start).isBetween(visibleStart, visibleEnd, null, '[]'),
      )
    : []

  const allServiceSetupsEnforced =
    scheduledEvents.length > 0 &&
    scheduledEvents.every((event) => enforcedServiceSetups[event.id.split('-')[0]])

  return {
    allocatedEvents: scheduledEvents,
    resources,
    filteredUnallocatedEvents,
    allServiceSetupsEnforced,
  }
}
