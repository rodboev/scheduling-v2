import { getDefaultDateRange } from '@/app/utils/dates'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { parseTimeRange, parseTime, round } from '@/app/utils/timeRange'
import axios from 'axios'
import { NextResponse } from 'next/server'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { HARD_MAX_RADIUS_MILES, TECH_SPEED_MPH } from '@/app/utils/constants'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
const isProduction = process.env.NODE_ENV === 'production'

function createServicesForRange(setup, startDate, endDate) {
  const services = []
  const start = dayjs(startDate)
  const end = dayjs(endDate)

  // Create services for the date range, including the end date
  for (let date = start; date.isSameOrBefore(end); date = date.add(1, 'day')) {
    if (shouldServiceOccur(setup.schedule.string, date)) {
      // Create the service's time window based on its original range
      const rangeStart =
        setup.time.range[0] !== null
          ? date.startOf('day').add(setup.time.range[0], 'seconds')
          : null
      const rangeEnd =
        setup.time.range[1] !== null
          ? date.startOf('day').add(setup.time.range[1], 'seconds')
          : null
      const preferred = date.startOf('day').add(parseTime(setup.time.preferred), 'seconds')
      const duration = Math.round(setup.time.duration / 15) * 15

      // Calculate scheduled start time based on preferred time
      const scheduledStart = preferred
      const scheduledEnd = dayjs(scheduledStart).add(duration, 'minutes')

      // Only create service if scheduled times fall within the time window
      if (rangeStart && rangeEnd && scheduledStart && scheduledEnd) {
        services.push({
          ...setup,
          id: `${setup.id}-${date.format('YYYY-MM-DD')}`,
          date: date.toDate(),
          start: scheduledStart.toDate(),
          end: scheduledEnd.toDate(),
          time: {
            range: [rangeStart.toDate(), rangeEnd.toDate()],
            preferred: preferred.toDate(),
            duration,
            meta: {
              dayRange: setup.time.range,
              originalRange: setup.time.originalRange,
              preferred: setup.time.preferred,
            },
          },
        })
      }
    }
  }

  return services
}

function shouldServiceOccur(scheduleString, date) {
  // Check if the service should occur on this date based on the schedule string
  const dayOfYear = date.dayOfYear()
  const scheduleIndex = dayOfYear - 1 // 0-based index
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
    const services = serviceSetups.flatMap(setup =>
      createServicesForRange(setup, startDate, endDate),
    )

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

      // Check for overlaps
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

    console.log('Techs with exactly matching services:', Array.from(techsWithOverlaps))

    // Filter out services from techs with overlaps
    const servicesWithoutOverlaps = services.filter(
      service => !techsWithOverlaps.has(service.tech.code),
    )
    console.log('Services after removing overlaps:', servicesWithoutOverlaps.length)

    // Get first 10 techs with services and filter services to only include those techs
    const numTechs = 20
    const selectedTechs = [
      ...new Set(servicesWithoutOverlaps.map(service => service.tech.code)),
    ].slice(0, numTechs)
    console.log(`First ${numTechs} techs with services: ${selectedTechs.join(', ')}`)
    const filteredServices = servicesWithoutOverlaps.filter(service =>
      selectedTechs.includes(service.tech.code),
    )

    // Uncomment for all techs:
    // const filteredServices = servicesWithoutOverlaps
    console.log(`Filtered to first ${numTechs} techs, total services:`, filteredServices.length)

    // Sort services by start time
    filteredServices.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

    // Get all unique location IDs
    const locationIds = new Set(filteredServices.map(service => service.location.id))

    // Get the full distance matrix at once
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
    const matrixResponse = await fetch(
      `${baseUrl}/api/distance-matrix?ids=${Array.from(locationIds).join(',')}`,
    )
    const distanceMatrix = await matrixResponse.json()

    // Function to get distance between two services using the matrix
    function getDistance(service1, service2) {
      const key = `${service1.location.id},${service2.location.id}`
      return distanceMatrix[key] || Infinity
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

    return new Response(JSON.stringify(finalGroups, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error generating services:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to generate services: ' + error.message }, null, 2),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    )
  }
}
