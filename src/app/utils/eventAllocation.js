// /src/app/utils/eventAllocation.js

import { allocateToResource } from './resourceManagement'
import { findBestTimeSlotBasedOnPreferred } from './timeSlotFinding'
import { addToScheduleSummary, generateScheduleSummaryText } from './scheduleSummary'
import { findConflictingEvents } from './eventConflicts'
import { dayjsInstance as dayjs } from './dayjs'

export function allocateEventsToResources(events) {
  // console.log('Allocating events:', events.length)
  const { techResources, genericResources } = initializeResources(events)

  const allocatedEvents = []
  const unallocatedEvents = []
  const changedEvents = []
  const scheduleSummary = {}
  const usedResources = new Set()

  events.sort(sortEventsPriority)

  for (const event of events) {
    const result = allocateToResource(event, allocatedEvents, techResources, genericResources)

    if (result.allocated) {
      allocatedEvents.push(result.allocatedEvent)
      addToScheduleSummary(scheduleSummary, result.allocatedEvent)
      usedResources.add(result.allocatedEvent.resourceId)
      if (result.changed) {
        changedEvents.push(createChangedEventEntry(result.allocatedEvent, event))
      }
    } else {
      unallocatedEvents.push(createUnallocatedEventEntry(event, allocatedEvents))
    }
  }

  logAllocationResults(allocatedEvents, unallocatedEvents, changedEvents)

  const resources = [...usedResources]
    .map(
      (resourceId) =>
        techResources.get(resourceId) || genericResources.find((r) => r.id === resourceId),
    )
    .filter(Boolean)

  const summaryText = generateScheduleSummaryText(scheduleSummary)

  return { allocatedEvents, resources, unallocatedEvents, changedEvents, summaryText }
}

function initializeResources(events, enforceTechs) {
  const techResources = new Map()
  const genericResources = []
  events.forEach((event) => {
    const techId = event.tech.code
    if (!techResources.has(techId)) {
      techResources.set(techId, { id: techId, title: event.tech.code })
    }
  })
  return { techResources, genericResources }
}

function sortEventsPriority(a, b) {
  if (a.tech.enforced && !b.tech.enforced) return -1
  if (!a.tech.enforced && b.tech.enforced) return 1
  if (a.time.enforced && !b.time.enforced) return -1
  if (!a.time.enforced && b.time.enforced) return 1
  return a.time.preferred.localeCompare(b.time.preferred)
}

function createChangedEventEntry(allocatedEvent, originalEvent) {
  return {
    event: allocatedEvent,
    reason: 'Range adjusted to match preferred time',
    originalRange: originalEvent.time.originalRange,
    newRange: `${dayjs(allocatedEvent.start).format('h:mma')} - ${dayjs(allocatedEvent.end).format('h:mma')}`,
  }
}

function createUnallocatedEventEntry(event, allocatedEvents) {
  return {
    event,
    reason: 'No available time slot found for any resource',
    conflictingEvents: findConflictingEvents(event, allocatedEvents),
  }
}

function logAllocationResults(allocatedEvents, unallocatedEvents, changedEvents) {
  console.log('Allocated events:', allocatedEvents.length)
  console.log('Unallocated events:', unallocatedEvents.length)
  console.log('Changed events:', changedEvents.length)
}
