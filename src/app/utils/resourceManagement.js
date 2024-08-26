// /src/app/utils/resourceManagement.js

import { createAllocatedEvent, canAllocateToResource } from './timeSlotFinding'

export function allocateToResource(
  event,
  allocatedEvents,
  enforceTechs,
  techResources,
  genericResources,
) {
  if (enforceTechs || event.tech.enforced) {
    return allocateToTechResource(event, allocatedEvents, techResources)
  } else {
    return allocateToGenericResource(event, allocatedEvents, genericResources)
  }
}

function allocateToTechResource(event, allocatedEvents, techResources) {
  const techId = event.tech.code
  if (!techResources.has(techId)) {
    techResources.set(techId, { id: techId, title: event.tech.code })
  }
  const canAllocate = canAllocateToResource(
    event,
    allocatedEvents.filter((e) => e.resourceId === techId),
  )
  if (canAllocate === true) {
    const allocatedEvent = createAllocatedEvent(event, techId, allocatedEvents)
    return { allocated: true, allocatedEvent, changed: allocatedEvent.changed }
  }
  return { allocated: false }
}

function allocateToGenericResource(event, allocatedEvents, genericResources) {
  for (let i = 0; i < genericResources.length + 1; i++) {
    const resourceId = `Tech ${i + 1}`
    const canAllocate = canAllocateToResource(
      event,
      allocatedEvents.filter((e) => e.resourceId === resourceId),
    )
    if (canAllocate === true) {
      if (i === genericResources.length) {
        genericResources.push({ id: resourceId, title: resourceId })
      }
      const allocatedEvent = createAllocatedEvent(event, resourceId, allocatedEvents)
      return { allocated: true, allocatedEvent, changed: allocatedEvent.changed }
    }
  }
  return { allocated: false }
}

export function getResourceById(resourceId, techResources, genericResources) {
  if (techResources.has(resourceId)) {
    return techResources.get(resourceId)
  }
  return genericResources.find((resource) => resource.id === resourceId)
}

export function getAllResources(techResources, genericResources) {
  return [...techResources.values(), ...genericResources]
}

export function addGenericResource(genericResources) {
  const newResourceId = `Tech ${genericResources.length + 1}`
  genericResources.push({ id: newResourceId, title: newResourceId })
  return newResourceId
}
