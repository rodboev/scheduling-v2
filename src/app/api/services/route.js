import { HARD_MAX_RADIUS_MILES, NUM_TECHS, SHOW_ONLY_BOROS, TECH_SPEED_MPH } from '@/app/utils/constants'
import { getDefaultDateRange } from '@/app/utils/dates'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { isPointInNYC } from '@/app/utils/geo'
import { createJsonResponse } from '@/app/utils/response'
import { parseTime } from '@/app/utils/timeRange'
import axios from 'axios'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const isProduction = process.env.NODE_ENV === 'production'

function createServicesForRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  // Validate time setup first
  if (!setup.time?.range || !Array.isArray(setup.time.range) || setup.time.range.length !== 2) {
    console.warn(`Setup ${setup.id}: Invalid time range: ${JSON.stringify(setup.time?.range)}`)
    return services
  }

  // Validate location setup
  if (!setup.location?.id || !setup.location?.latitude || !setup.location?.longitude ||
      (setup.location.latitude === 0 && setup.location.longitude === 0)) {
    console.warn(`Setup ${setup.id}: Potentially invalid location (${setup.location?.latitude}, ${setup.location?.longitude})`)
    // Don't return early, let it continue
  }

  // Log when service occurs
  for (let date = start; date.isBefore(end); date = date.add(1, 'day')) {
    if (shouldServiceOccur(setup.schedule.string, date)) {
      // Create the service's time window based on its original range
      const rangeStart = setup.time.range[0] !== null
        ? date.startOf('day').add(setup.time.range[0], 'seconds')
        : null
      const rangeEnd = setup.time.range[1] !== null
        ? date.startOf('day').add(setup.time.range[1], 'seconds')
        : null

      // Skip if either range bound is invalid
      if (!rangeStart || !rangeEnd) {
        console.warn(`Setup ${setup.id}: Invalid range bounds - start: ${rangeStart}, end: ${rangeEnd}`)
        continue
      }

      // Validate preferred time exists and is parseable
      const parsedPreferredTime = parseTime(setup.time.preferred)
      if (parsedPreferredTime === null) {
        console.warn(`Setup ${setup.id}: Could not parse preferred time: ${setup.time.preferred}`)
        continue
      }

      const preferred = date.startOf('day').add(parsedPreferredTime, 'seconds')
      const duration = Math.round(setup.time.duration / 15) * 15

      // Validate duration
      if (!duration || duration <= 0 || duration > 480) {
        console.warn(`Setup ${setup.id}: Invalid duration: ${duration}`)
        continue
      }

      // Calculate scheduled start time based on preferred time
      const scheduledStart = preferred
      const scheduledEnd = dayjs(scheduledStart).add(duration, 'minutes')

      // Only create service if scheduled times fall within the requested range
      if (scheduledStart.isBefore(end) && scheduledEnd.isAfter(start)) {
        const { schedule, comments, ...serviceWithoutOmittedFields } = setup
        
        services.push({
          ...serviceWithoutOmittedFields,
          id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
          date: date.toDate(),
          start: scheduledStart.toDate(),
          end: scheduledEnd.toDate(),
          time: {
            range: [rangeStart.toDate(), rangeEnd.toDate()],
            preferred: preferred.toDate(),
            duration,
            meta: {
              originalRange: setup.time.originalRange,
              preferred: setup.time.preferred,
            },
          },
          location: {
            ...setup.location,
            latitude: parseFloat(setup.location.latitude),
            longitude: parseFloat(setup.location.longitude),
          }
        })
      } else {
        console.log(`Setup ${setup.id}: Service outside requested range`)
      }
    }
  }

  return services
}

function shouldServiceOccur(scheduleString, date) {
  // Each month has 5 weeks × 7 days = 35 days
  const DAYS_PER_MONTH = 35
  const DAYS_PER_WEEK = 7

  // Get month (0-11) and day of week (0-6)
  const month = date.month()
  const dayOfWeek = date.day() // 0 = Sunday, 1 = Monday, etc.

  // Get the week number (0-4) based on the day of month
  // For example: Sept 3 is a Tuesday, so it's in week 0
  const weekNumber = Math.floor((date.date() - 1) / 7)

  // Calculate position in the 35-day month pattern (0-indexed)
  const monthStart = month * DAYS_PER_MONTH
  const dayPosition = weekNumber * DAYS_PER_WEEK + dayOfWeek
  const scheduleIndex = monthStart + dayPosition

  // Safety check for index bounds (schedule string is exactly 420 characters)
  if (scheduleIndex >= 420) {
    console.warn(`Index ${scheduleIndex} out of bounds for schedule string (length: 420)`)
    return false
  }

  return scheduleString[scheduleIndex] === '1'
}

async function fetchServiceSetups() {
  try {
    const response = await axios.get(`${BASE_URL}/api/serviceSetups`)
    console.log('Fetched service setups:', response.data.length)
    return response.data
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const { start: defaultStart, end: defaultEnd } = getDefaultDateRange()

  const start = searchParams.get('start') || defaultStart
  const end = searchParams.get('end') || defaultEnd

  const startDate = dayjs(start)
  const endDate = dayjs(end)

  try {
    const serviceSetups = await fetchServiceSetups()
    // Generate services for the date range
    let services = serviceSetups.flatMap(setup => {
      const generatedServices = createServicesForRange(setup, startDate, endDate)
      return generatedServices
    })

    console.log('Total services before any filtering:', services.length)

    // Filter out services outside NYC if SHOW_ONLY_BOROS is true
    if (SHOW_ONLY_BOROS) {
      const beforeCount = services.length
      services = services.filter(service => {
        const { latitude, longitude } = service.location
        return isPointInNYC(latitude, longitude)
      })
      console.log(`Filtered out ${beforeCount - services.length} services outside NYC`)
    }

    // Read enforcement state
    const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')
    let enforcementState = {}

    try {
      const rawEnforcementState = await fsPromises.readFile(filePath, 'utf8')
      const parsedState = JSON.parse(rawEnforcementState)
      if (parsedState?.cacheData) {
        enforcementState = parsedState.cacheData
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fsPromises.writeFile(filePath, JSON.stringify({ cacheData: {} }))
      } else {
        console.error('Error reading enforcement state:', error)
      }
    }

    // Remove techs with overlapping services
    const techServices = {}
    const techsWithOverlaps = new Set()

    // Group services by tech
    for (const service of services) {
      const techCode = service.tech.code
      if (!techServices[techCode]) {
        techServices[techCode] = []
      }
      techServices[techCode].push(service)
    }

    // Helper function to check if two times are exactly equal
    function areTimesEqual(time1, time2) {
      return new Date(time1).getTime() === new Date(time2).getTime()
    }

    // Check each tech's services for overlaps
    for (const [techCode, techServiceList] of Object.entries(techServices)) {
      // Sort services by start time
      const sortedServices = techServiceList.sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      )

      // For Tech 2, check for any time overlap, not just exact matches
      if (techCode === 'Tech 2') {
        for (let i = 0; i < sortedServices.length; i++) {
          for (let j = i + 1; j < sortedServices.length; j++) {
            const service1 = sortedServices[i]
            const service2 = sortedServices[j]

            const start1 = new Date(service1.start).getTime()
            const end1 = new Date(service1.end).getTime()
            const start2 = new Date(service2.start).getTime()
            const end2 = new Date(service2.end).getTime()

            // Check for any overlap
            if (start1 < end2 && end1 > start2) {
              techsWithOverlaps.add(techCode)
              console.log(`Overlap found for tech ${techCode}:`, {
                service1: {
                  id: service1.id,
                  company: service1.company,
                  scheduled: {
                    start: new Date(service1.start).toISOString(),
                    end: new Date(service1.end).toISOString(),
                  }
                },
                service2: {
                  id: service2.id,
                  company: service2.company,
                  scheduled: {
                    start: new Date(service2.start).toISOString(),
                    end: new Date(service2.end).toISOString(),
                  }
                }
              })
              break
            }
          }
          if (techsWithOverlaps.has(techCode)) break
        }
      } else {
        // For other techs, keep existing exact match check
        for (let i = 0; i < sortedServices.length; i++) {
          for (let j = i + 1; j < sortedServices.length; j++) {
            const service1 = sortedServices[i]
            const service2 = sortedServices[j]

            // Check if both scheduled times and range times are exactly the same
            const scheduledMatch =
              areTimesEqual(service1.start, service2.start) &&
              areTimesEqual(service1.end, service2.end)

            const rangeMatch =
              areTimesEqual(service1.time.range[0], service2.time.range[0]) &&
              areTimesEqual(service1.time.range[1], service2.time.range[1])

            if (scheduledMatch && rangeMatch) {
              techsWithOverlaps.add(techCode)
              console.log(`Exact time match found for tech ${techCode}:`, {
                service1: {
                  id: service1.id,
                  company: service1.company,
                  scheduled: {
                    start: new Date(service1.start).toISOString(),
                    end: new Date(service1.end).toISOString(),
                  },
                  range: {
                    start: new Date(service1.time.range[0]).toISOString(),
                    end: new Date(service1.time.range[1]).toISOString(),
                  },
                },
                service2: {
                  id: service2.id,
                  company: service2.company,
                  scheduled: {
                    start: new Date(service2.start).toISOString(),
                    end: new Date(service2.end).toISOString(),
                  },
                  range: {
                    start: new Date(service2.time.range[0]).toISOString(),
                    end: new Date(service2.time.range[1]).toISOString(),
                  },
                },
              })
              break
            }
          }
          if (techsWithOverlaps.has(techCode)) break
        }
      }
    }

    console.log('Techs with exactly matching services:', Array.from(techsWithOverlaps))

    // Filter out services from techs with overlaps
    const servicesWithoutOverlaps = services.filter(
      service => !techsWithOverlaps.has(service.tech.code),
    )
    console.log('Services after removing overlaps:', servicesWithoutOverlaps.length)

    let filteredServices
    if (NUM_TECHS > 0) {
      // Get first 10 techs with services and filter services to only include those techs
      const selectedTechs = [
        ...new Set(servicesWithoutOverlaps.map(service => service.tech.code)),
      ].slice(0, NUM_TECHS)
      console.log(`First ${NUM_TECHS} techs with services: ${selectedTechs.join(', ')}`)
      filteredServices = servicesWithoutOverlaps.filter(service =>
        selectedTechs.includes(service.tech.code),
      )
      console.log(`Filtered to first ${NUM_TECHS} techs, total services:`, filteredServices.length)
    } else {
      filteredServices = servicesWithoutOverlaps
    }

    // Sort services by start time
    filteredServices.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    // Get unique location IDs in the order of services array
    const locationIds = Array.from(
      new Set(services.map(s => s.location?.id?.toString()).filter(Boolean)),
    )

    // Get the full distance matrix at once
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    const matrixResponse = await fetch(
      `${baseUrl}/api/distance-matrix?ids=${locationIds.join(',')}`,
    )
    const distanceMatrix = await matrixResponse.json()

    // Function to get distance between two services using the matrix
    function getDistance(service1, service2) {
      const idx1 = locationIds.indexOf(service1.location.id.toString())
      const idx2 = locationIds.indexOf(service2.location.id.toString())
      if (idx1 === -1 || idx2 === -1) return Infinity
      return distanceMatrix[idx1][idx2] || Infinity
    }

    // Function to check if a service can fit in a group with lookahead
    async function canFitInGroup(service, group, depth = 5) {
      if (depth === 0) return false

      // Create a copy of the service to modify
      const serviceCopy = {
        ...service,
        start: new Date(service.start),
        end: new Date(service.end),
        time: {
          ...service.time,
          range: [new Date(service.time.range[0]), new Date(service.time.range[1])],
        },
      }

      // Sort group by start time
      const sortedGroup = [...group].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      )

      // Try each position in the group
      for (let i = 0; i <= sortedGroup.length; i++) {
        const prevService = i > 0 ? sortedGroup[i - 1] : null
        const nextService = i < sortedGroup.length ? sortedGroup[i] : null

        // Calculate available time slot
        const slotStart = prevService
          ? new Date(prevService.end).getTime()
          : new Date(serviceCopy.time.range[0]).getTime()
        const slotEnd = nextService
          ? new Date(nextService.start).getTime()
          : new Date(serviceCopy.time.range[1]).getTime()

        const serviceDuration =
          new Date(serviceCopy.end).getTime() - new Date(serviceCopy.start).getTime()

        // Check if service fits in this slot
        if (slotEnd - slotStart >= serviceDuration) {
          // Check distances and travel times
          if (prevService) {
            const distance = getDistance(prevService, serviceCopy)
            if (distance > HARD_MAX_RADIUS_MILES) continue
            // Check if there's enough time to travel
            const travelTime = (distance / TECH_SPEED_MPH) * 60 // Convert to minutes
            const adjustedStart = Math.max(
              slotStart + travelTime * 60000,
              new Date(serviceCopy.time.range[0]).getTime(),
            )
            if (adjustedStart + serviceDuration > new Date(serviceCopy.time.range[1]).getTime())
              continue

            // Adjust service time
            serviceCopy.start = new Date(adjustedStart)
            serviceCopy.end = new Date(adjustedStart + serviceDuration)
          } else {
            // If no previous service, try to schedule at the earliest possible time
            const newStart = new Date(serviceCopy.time.range[0]).getTime()
            serviceCopy.start = new Date(newStart)
            serviceCopy.end = new Date(newStart + serviceDuration)
          }

          // Verify the adjusted time works with the next service
          if (nextService) {
            const distance = getDistance(serviceCopy, nextService)
            if (distance > HARD_MAX_RADIUS_MILES) continue
            // Check if there's enough time to travel
            const travelTime = (distance / TECH_SPEED_MPH) * 60 // Convert to minutes
            if (
              new Date(serviceCopy.end).getTime() + travelTime * 60000 >
              new Date(nextService.start).getTime()
            ) {
              // Try to shift service earlier if possible
              const maxEnd = new Date(nextService.start).getTime() - travelTime * 60000
              const requiredStart = maxEnd - serviceDuration
              if (requiredStart < new Date(serviceCopy.time.range[0]).getTime()) continue

              serviceCopy.start = new Date(requiredStart)
              serviceCopy.end = new Date(maxEnd)
            }
          }

          // Try shifting existing services to make room if needed
          const tempGroup = [...sortedGroup]
          tempGroup.splice(i, 0, serviceCopy)

          // Try to adjust times of services after this one
          let canAdjust = true
          let currentTime = new Date(serviceCopy.end).getTime()

          // Create copies of all services to modify
          const adjustedServices = tempGroup.map(s => ({
            ...s,
            start: new Date(s.start),
            end: new Date(s.end),
            time: {
              ...s.time,
              range: [new Date(s.time.range[0]), new Date(s.time.range[1])],
            },
          }))

          for (let j = i + 1; j < adjustedServices.length; j++) {
            const curr = adjustedServices[j]
            const prev = adjustedServices[j - 1]

            const distance = getDistance(prev, curr)
            const travelTime = (distance / TECH_SPEED_MPH) * 60 // Convert to minutes
            const minStart = currentTime + travelTime * 60000
            const duration = new Date(curr.end).getTime() - new Date(curr.start).getTime()

            // Try to schedule within the service's time window
            if (minStart + duration <= new Date(curr.time.range[1]).getTime()) {
              curr.start = new Date(minStart)
              curr.end = new Date(minStart + duration)
              currentTime = new Date(curr.end).getTime()
            } else {
              canAdjust = false
              break
            }
          }

          if (canAdjust) {
            // Update the original service with the adjusted times
            service.start = new Date(serviceCopy.start)
            service.end = new Date(serviceCopy.end)

            // Update times for all affected services
            for (let j = i + 1; j < group.length; j++) {
              const originalService = group[j]
              const adjustedService = adjustedServices[j]
              originalService.start = new Date(adjustedService.start)
              originalService.end = new Date(adjustedService.end)
            }
            return true
          }

          // If we can't fit directly, try recursively with remaining services
          const remainingServices = sortedGroup.slice(i)
          if (await canFitInGroup(serviceCopy, remainingServices, depth - 1)) {
            // Update the original service with the adjusted times
            service.start = new Date(serviceCopy.start)
            service.end = new Date(serviceCopy.end)
            return true
          }
        }
      }
      return false
    }

    // Function to find closest service to a group
    function findClosestService(service, group) {
      let minDistance = Infinity
      let closest = null

      for (const other of group) {
        const distance = getDistance(service, other)
        if (distance < minDistance) {
          minDistance = distance
          closest = other
        }
      }
      return { service: closest, distance: minDistance }
    }

    // Build groups based on geographic proximity and time compatibility
    const serviceGroups = []
    const usedServices = new Set()

    // Start with services that have the most restrictive time windows
    const servicesWithTimeWindows = [...filteredServices].sort((a, b) => {
      const aWindow = new Date(a.time.range[1]) - new Date(a.time.range[0])
      const bWindow = new Date(b.time.range[1]) - new Date(b.time.range[0])
      if (aWindow !== bWindow) return aWindow - bWindow // Most restrictive first
      return new Date(a.start).getTime() - new Date(b.start).getTime() // Then by start time
    })

    // Helper to try merging a service into existing groups
    async function tryMergeIntoExistingGroups(service) {
      // Sort groups by size (descending) and then by closest distance
      const sortedGroups = [...serviceGroups].sort((a, b) => {
        if (a.length !== b.length) return b.length - a.length
        const distA = Math.min(...a.map(s => getDistance(service, s)))
        const distB = Math.min(...b.map(s => getDistance(service, s)))
        return distA - distB
      })

      // First try to merge with groups that have overlapping time windows
      for (const group of sortedGroups) {
        const groupStart = Math.min(...group.map(s => new Date(s.time.range[0]).getTime()))
        const groupEnd = Math.max(...group.map(s => new Date(s.time.range[1]).getTime()))
        const serviceStart = new Date(service.time.range[0]).getTime()
        const serviceEnd = new Date(service.time.range[1]).getTime()

        // Check if time windows overlap
        if (serviceStart <= groupEnd && serviceEnd >= groupStart) {
          const { distance } = findClosestService(service, group)
          if (distance <= HARD_MAX_RADIUS_MILES && (await canFitInGroup(service, group))) {
            group.push(service)
            return true
          }
        }
      }
      return false
    }

    // First pass: Create initial groups
    for (const service of servicesWithTimeWindows) {
      if (usedServices.has(service.id)) continue

      // Try to add to existing group first
      if (await tryMergeIntoExistingGroups(service)) {
        usedServices.add(service.id)
        continue
      }

      // Create new group if can't merge
      let currentGroup = [service]
      usedServices.add(service.id)

      // Try to add nearby compatible services
      let added
      do {
        added = false
        for (const other of servicesWithTimeWindows) {
          if (usedServices.has(other.id)) continue

          const { distance } = findClosestService(other, currentGroup)
          if (distance <= HARD_MAX_RADIUS_MILES && (await canFitInGroup(other, currentGroup))) {
            currentGroup.push(other)
            usedServices.add(other.id)
            added = true
          }
        }
      } while (added)

      if (currentGroup.length > 0) {
        serviceGroups.push(currentGroup)
      }
    }

    // Second pass: Try to merge groups more aggressively
    let merged
    do {
      merged = false
      // Sort groups by size (descending) and then by earliest start time
      serviceGroups.sort((a, b) => {
        if (a.length !== b.length) return b.length - a.length
        const aStart = Math.min(...a.map(s => new Date(s.start).getTime()))
        const bStart = Math.min(...b.map(s => new Date(s.start).getTime()))
        return aStart - bStart
      })

      for (let i = 0; i < serviceGroups.length; i++) {
        const group1 = serviceGroups[i]

        // Try to merge single-service groups first
        const singleServiceGroups = serviceGroups
          .slice(i + 1)
          .filter(g => g.length === 1)
          .sort((a, b) => {
            const distA = Math.min(...group1.map(s => getDistance(s, a[0])))
            const distB = Math.min(...group1.map(s => getDistance(s, b[0])))
            return distA - distB
          })

        for (const group2 of singleServiceGroups) {
          if (await canFitInGroup(group2[0], group1)) {
            group1.push(group2[0])
            serviceGroups.splice(serviceGroups.indexOf(group2), 1)
            merged = true
            break
          }
        }

        if (merged) break

        // Try regular group merging
        for (let j = i + 1; j < serviceGroups.length; j++) {
          const group2 = serviceGroups[j]

          // Check if time windows overlap
          const group1Start = Math.min(...group1.map(s => new Date(s.time.range[0]).getTime()))
          const group1End = Math.max(...group1.map(s => new Date(s.time.range[1]).getTime()))
          const group2Start = Math.min(...group2.map(s => new Date(s.time.range[0]).getTime()))
          const group2End = Math.max(...group2.map(s => new Date(s.time.range[1]).getTime()))

          if (group2Start <= group1End && group2End >= group1Start) {
            // Check if any services in group2 are close to group1
            const anyClose = group2.some(service1 =>
              group1.some(service2 => getDistance(service1, service2) <= HARD_MAX_RADIUS_MILES),
            )

            if (!anyClose) continue

            // Try to merge all services from group2 into group1
            let canMergeAll = true
            for (const service of group2) {
              if (!(await canFitInGroup(service, group1))) {
                canMergeAll = false
                break
              }
            }

            if (canMergeAll) {
              serviceGroups[i] = [...group1, ...group2]
              serviceGroups.splice(j, 1)
              merged = true
              break
            }
          }
        }
        if (merged) break
      }
    } while (merged)

    // Flatten groups and sort by start time
    const finalGroups = serviceGroups.flat()
    finalGroups.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    return createJsonResponse(finalGroups)
  } catch (error) {
    console.error('Error generating services:', error)
    return createJsonResponse(
      { error: 'Failed to generate services: ' + error.message },
      { status: 500 },
    )
  }
}
