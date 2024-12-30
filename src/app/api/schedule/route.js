import axios from 'axios'
import { NextResponse } from 'next/server'
import { scheduleServices } from '../../scheduling/index.js'

const SHIFTS = {
  1: { start: '08:00', end: '16:00' }, // 8am-4pm
  2: { start: '16:00', end: '00:00' }, // 4pm-12am
  3: { start: '00:00', end: '08:00' }, // 12am-8am
}

function getShiftForTime(time) {
  const hour = new Date(time).getUTCHours()
  if (hour >= 8 && hour < 16) return 1
  if (hour >= 16) return 2
  return 3
}

async function fetchServices(start, end) {
  try {
    const response = await axios.get(`http://localhost:${process.env.PORT}/api/services`, {
      params: { start, end },
    })
    return response.data
  } catch (error) {
    console.error('Error fetching services:', error)
    throw error
  }
}

export async function GET(request) {
  console.log('Schedule API route called')

  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') || '2024-09-03T02:30:00.000Z'
  const end = searchParams.get('end') || '2024-09-03T12:30:00.999Z'

  try {
    const services = await fetchServices(start, end)
    console.log(`Fetched ${services.length} services for scheduling`)

    // Process all services at once
    let result = null
    for await (const update of scheduleServices(services)) {
      if (update.type === 'result') {
        result = update
        break
      }
    }

    if (!result) {
      return NextResponse.json({ error: 'No result from scheduling' }, { status: 500 })
    }

    const { scheduledServices, unassignedServices } = result.data

    // Group services by tech and date
    const techDayGroups = {}
    for (const service of scheduledServices) {
      const date = new Date(service.start).toISOString().split('T')[0]
      const techId = service.resourceId
      const shift = getShiftForTime(service.start)
      const key = `${techId}_${date}_${shift}`

      if (!techDayGroups[key]) {
        techDayGroups[key] = []
      }
      techDayGroups[key].push(service)
    }

    // Assign cluster numbers and sequence numbers
    let clusterNum = 0
    const processedServices = []

    for (const [key, services] of Object.entries(techDayGroups)) {
      // Sort services by start time within each group
      services.sort((a, b) => new Date(a.start) - new Date(b.start))

      // Assign cluster and sequence numbers
      for (let i = 0; i < services.length; i++) {
        const service = services[i]
        service.cluster = clusterNum
        service.sequenceNumber = i + 1

        // Calculate distance from previous service in cluster
        if (i > 0) {
          const prevService = services[i - 1]
          const distance = calculateDistance(
            prevService.location.latitude,
            prevService.location.longitude,
            service.location.latitude,
            service.location.longitude,
          )
          service.distanceFromPrevious = distance
          service.previousCompany = prevService.company
        }

        processedServices.push(service)
      }
      clusterNum++
    }

    // Group unassigned services by reason
    const unassignedGroups = unassignedServices.reduce((acc, service) => {
      acc[service.reason] = (acc[service.reason] || 0) + 1
      return acc
    }, {})

    // Create summary messages for unassigned services
    const unassignedSummaries = Object.entries(unassignedGroups).map(
      ([reason, count]) => `${count} services unassigned. Reason: ${reason}`,
    )

    return NextResponse.json({
      scheduledServices: processedServices,
      unassignedServices: unassignedSummaries,
      clusteringInfo: {
        totalClusters: clusterNum,
        connectedPointsCount: processedServices.length,
        outlierCount: unassignedServices.length,
        performanceDuration: result.performanceDuration || 0,
      },
    })
  } catch (error) {
    console.error('Error in schedule route:', error)
    return NextResponse.json({ error: 'Failed to process services' }, { status: 500 })
  }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371 // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c // Distance in km converted to miles
}
