// /src/app/utils/eventConflicts.js

/**
 * Finds events that conflict with the given event.
 *
 * @param {Object} event - The event to check for conflicts.
 * @param {Array} allocatedEvents - The list of already allocated events.
 * @returns {Array} - A list of conflicting events.
 */
export function findConflictingEvents(event, allocatedEvents) {
  const eventStart = event.start.getTime()
  const eventEnd = eventStart + event.time.duration * 60 * 1000 // Convert duration to milliseconds

  return allocatedEvents.filter((allocatedEvent) => {
    const allocatedStart = allocatedEvent.start.getTime()
    const allocatedEnd = allocatedEvent.end.getTime()

    // Check if there's any overlap
    return eventStart < allocatedEnd && eventEnd > allocatedStart
  })
}

/**
 * Checks if two events conflict with each other.
 *
 * @param {Object} event1 - The first event.
 * @param {Object} event2 - The second event.
 * @returns {boolean} - True if the events conflict, false otherwise.
 */
export function doEventsConflict(event1, event2) {
  const start1 = event1.start.getTime()
  const end1 = event1.end.getTime()
  const start2 = event2.start.getTime()
  const end2 = event2.end.getTime()

  return start1 < end2 && end1 > start2
}

/**
 * Calculates the overlap duration between two events.
 *
 * @param {Object} event1 - The first event.
 * @param {Object} event2 - The second event.
 * @returns {number} - The overlap duration in milliseconds.
 */
export function calculateOverlap(event1, event2) {
  const start1 = event1.start.getTime()
  const end1 = event1.end.getTime()
  const start2 = event2.start.getTime()
  const end2 = event2.end.getTime()

  const overlapStart = Math.max(start1, start2)
  const overlapEnd = Math.min(end1, end2)

  return Math.max(0, overlapEnd - overlapStart)
}

/**
 * Finds the total conflict duration for an event against a list of allocated events.
 *
 * @param {Object} event - The event to check.
 * @param {Array} allocatedEvents - The list of already allocated events.
 * @returns {number} - The total conflict duration in milliseconds.
 */
export function getTotalConflictDuration(event, allocatedEvents) {
  return allocatedEvents.reduce((totalDuration, allocatedEvent) => {
    if (doEventsConflict(event, allocatedEvent)) {
      return totalDuration + calculateOverlap(event, allocatedEvent)
    }
    return totalDuration
  }, 0)
}
