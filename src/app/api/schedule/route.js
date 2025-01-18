import { getFullDistanceMatrix } from '@/app/utils/locationCache'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { dayjsInstance } from '@/app/utils/dayjs'
import axios from 'axios'
import { createJsonResponse } from '@/app/utils/response'

const MAX_DAYS_PER_REQUEST = 2 // Process 2 days at a time

// Helper function to check if two services overlap in time
function doServicesOverlap(service1, service2) {
  const start1 = new Date(service1.start).getTime()
  const end1 = new Date(service1.end).getTime()
  const start2 = new Date(service2.start).getTime()
  const end2 = new Date(service2.end).getTime()

  // Check if one service starts during the other service
  return (start1 < end2 && start2 < end1)
}

// Helper function to check for overlaps in a tech's services
function findOverlappingServices(services) {
  const overlaps = []
  const sortedServices = [...services].sort((a, b) => 
    new Date(a.start).getTime() - new Date(b.start).getTime()
  )

  for (let i = 0; i < sortedServices.length - 1; i++) {
    const current = sortedServices[i]
    const next = sortedServices[i + 1]
    if (doServicesOverlap(current, next)) {
      overlaps.push([current, next])
    }
  }

  return overlaps
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = dayjsInstance(searchParams.get('start'))
  const end = dayjsInstance(searchParams.get('end'))
  const techId = searchParams.get('tech') ? `Tech ${searchParams.get('tech')}` : null
  console.log('Schedule API called with params:', Object.fromEntries(searchParams))

  if (!start.isValid() || !end.isValid()) {
    return createJsonResponse({ error: 'Invalid date range' }, { status: 400 })
  }

  try {
    console.log('Date range:', {
      normalizedStart: start.format(),
      normalizedEnd: end.format(),
    })

    // Calculate number of days in request
    const totalDays = end.diff(start, 'day')
    console.log('Total days requested:', totalDays)

    // If request is within limit, process normally
    if (totalDays <= MAX_DAYS_PER_REQUEST) {
      const result = await processDateRange(start, end)
      
      // Initialize arrays if they don't exist
      result.unassignedServices = result.unassignedServices || []
      result.schedulingDetails = result.schedulingDetails || {
        unscheduledServices: [],
        summary: {
          totalUnscheduled: 0,
          reasonBreakdown: {}
        }
      }
      
      // Check for overlaps in Tech 2's services
      if (techId === 'Tech 2' || !techId) {
        const tech2Services = result.scheduledServices.filter(s => s.techId === 'Tech 2')
        const overlaps = findOverlappingServices(tech2Services)
        
        if (overlaps.length > 0) {
          console.log('Found overlapping services for Tech 2:', overlaps)
          
          // Remove overlapping services from the schedule
          const overlappingIds = new Set(overlaps.flat().map(s => s.id))
          result.scheduledServices = result.scheduledServices.filter(s => !overlappingIds.has(s.id))
          
          // Add removed services to unassigned with reason
          const unassignedOverlaps = overlaps.flat().map(service => ({
            ...service,
            reason: 'TECH_2_OVERLAP'
          }))
          result.unassignedServices.push(...unassignedOverlaps)
          
          // Update scheduling details
          result.schedulingDetails.unscheduledServices.push(...unassignedOverlaps)
          result.schedulingDetails.summary.totalUnscheduled += unassignedOverlaps.length
          result.schedulingDetails.summary.reasonBreakdown.TECH_2_OVERLAP = 
            (result.schedulingDetails.summary.reasonBreakdown.TECH_2_OVERLAP || 0) + unassignedOverlaps.length
        }
      }
      
      return createJsonResponse(result)
    }

    // Otherwise, split into chunks and process sequentially
    const chunks = []
    let chunkStart = start.clone()
    while (chunkStart.isBefore(end)) {
      const chunkEnd = chunkStart.clone().add(MAX_DAYS_PER_REQUEST, 'day')
      if (chunkEnd.isAfter(end)) {
        chunks.push([chunkStart, end])
      } else {
        chunks.push([chunkStart, chunkEnd])
      }
      chunkStart = chunkEnd
    }

    console.log('Processing in chunks:', chunks.length)
    const results = []
    for (const [s, e] of chunks) {
      const result = await processDateRange(s, e)
      // Filter each chunk for specific tech if requested
      if (techId) {
        result.scheduledServices = result.scheduledServices.filter(s => s.techId === techId)
        // Update clustering info for filtered services
        const filteredClusters = new Set(result.scheduledServices.map(s => s.cluster))
        result.clusteringInfo.totalClusters = filteredClusters.size
        result.clusteringInfo.connectedPointsCount = result.scheduledServices.length
        result.clusteringInfo.clusterDistribution = result.scheduledServices.reduce((acc, service) => {
          if (service.cluster >= 0) {
            const cluster = service.cluster
            acc[cluster] = (acc[cluster] || 0) + 1
          }
          return acc
        }, [])
        result.clusteringInfo.techAssignments = {
          [techId]: result.clusteringInfo.techAssignments[techId] || { services: 0, startTime: 0 }
        }
      }
      results.push(result)
    }

    // Combine results
    const combinedResult = {
      initialServices: results.reduce((sum, r) => sum + r.initialServices, 0),
      scheduledServices: results.flatMap(r => r.scheduledServices || []),
      unassignedServices: results.flatMap(r => r.unassignedServices || []),
      clusteringInfo: results.reduce((acc, r) => ({
        ...acc,
        ...r.clusteringInfo,
        performanceDuration: (acc.performanceDuration || 0) + (r.clusteringInfo?.performanceDuration || 0),
      }), {}),
      schedulingDetails: results.reduce((acc, r) => {
        if (!acc) return r.schedulingDetails
        return {
          totalServices: acc.totalServices + r.schedulingDetails.totalServices,
          scheduledServices: acc.scheduledServices + r.schedulingDetails.scheduledServices,
          unscheduledServices: [...acc.unscheduledServices, ...r.schedulingDetails.unscheduledServices],
          summary: {
            totalUnscheduled: acc.summary.totalUnscheduled + r.schedulingDetails.summary.totalUnscheduled,
            reasonBreakdown: Object.entries(r.schedulingDetails.summary.reasonBreakdown).reduce((breakdown, [key, value]) => {
              breakdown[key] = (breakdown[key] || 0) + value
              return breakdown
            }, {...acc.summary.reasonBreakdown})
          }
        }
      }, null)
    }

    return createJsonResponse(combinedResult)
  } catch (error) {
    console.error('Error in schedule API:', error)
    return createJsonResponse(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    )
  }
}

export async function POST(request) {
  try {
    const { services } = await request.json()

    // Validate services array
    if (!Array.isArray(services)) {
      return createJsonResponse(
        { error: 'Invalid request: services must be an array' },
        { status: 400 }
      )
    }

    // Filter valid services
    const validServices = services.filter(service =>
      service?.time?.range?.[0] &&
      service?.time?.range?.[1] &&
      service?.location?.latitude &&
      service?.location?.longitude
    )

    // Get distance matrix for locations
    const locationIds = validServices
      .map(service => service.location?.id?.toString())
      .filter(Boolean)

    const distanceMatrix = await getFullDistanceMatrix(locationIds, {
      force: true,
      format: 'object'
    })

    // Process services using worker thread
    const worker = new Worker(path.join(process.cwd(), 'src/app/api/schedule/worker.js'))
    
    const result = await new Promise((resolve, reject) => {
      worker.on('message', resolve)
      worker.postMessage({ services: validServices, distanceMatrix })
    })

    return createJsonResponse(result)
  } catch (error) {
    return createJsonResponse(
      { error: error.message || 'Internal server error' },
      { status: error.status || 500 }
    )
  }
}

async function processDateRange(start, end) {
  const startTime = performance.now()

  try {
    // Get services for date range
    const response = await axios.get(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/services`, {
      params: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })

    console.log('Initial services from /services:', response.data.length)

    // Track services filtered due to missing time range
    const missingTimeRangeServices = response.data.filter(service => {
      if (!service.time.range[0] || !service.time.range[1]) {
        console.log('Filtered out service missing time range:', service.id)
        return true
      }
      return false
    }).map(service => ({
      id: service.id,
      company: service.company,
      location: {
        id: service.location?.id,
        address: service.location?.address
      },
      time: {
        range: service.time.range,
        duration: service.time.duration
      },
      reason: `INVALID_TIME_RANGE${service.time?.meta?.originalRange ? ` (${service.time.meta.originalRange})` : ' ()'}`
    }))

    const services = response.data.filter(service => {
      if (!service.time.range[0] || !service.time.range[1]) return false
      const serviceDate = dayjsInstance(service.date)
      const isInRange = serviceDate.isBetween(start, end, null, '[)')
      if (!isInRange) {
        console.log('Filtered out service outside date range:', service.id, {
          serviceDate: serviceDate.format(),
          start: start.format(),
          end: end.format()
        })
      }
      return isInRange
    })

    console.log('Services after date/time filtering:', services.length)

    // Track invalid services before filtering
    const invalidServices = services.filter(service => {
      // Check for missing location ID
      if (!service.location?.id?.toString()) {
        console.log('Service missing location ID:', service.id)
        return true
      }
      
      // Check for invalid coordinates (0,0 or missing)
      const lat = service.location.latitude
      const lng = service.location.longitude
      if (!lat || !lng || (lat === 0 && lng === 0)) {
        console.log('Service has invalid coordinates:', service.id, { lat, lng })
        return true
      }
      
      return false
    }).map(service => ({
      id: service.id,
      company: service.company,
      location: {
        id: service.location?.id,
        address: service.location?.address,
        coordinates: {
          latitude: service.location?.latitude,
          longitude: service.location?.longitude
        }
      },
      time: {
        range: service.time.range,
        duration: service.time.duration
      },
      reason: !service.location?.id?.toString() 
        ? 'MISSING_LOCATION' 
        : `INVALID_COORDINATES: (${service.location.latitude},${service.location.longitude})`
    }))

    console.log('Invalid services:', invalidServices.length, invalidServices)

    // Update validServices filter accordingly
    const validServices = services.filter(service => {
      if (!service.location?.id?.toString()) return false
      const lat = service.location.latitude
      const lng = service.location.longitude
      if (!lat || !lng || (lat === 0 && lng === 0)) return false
      return true
    })

    console.log('Valid services:', validServices.length)

    // Add originalIndex to each service before sending to worker
    const validServicesWithIndex = validServices.map((service, index) => ({
      ...service,
      originalIndex: index
    }))

    // Get unique location IDs from valid services
    const locationIds = validServicesWithIndex.map(s => s.location.id.toString())

    // Get distance matrix in array format
    console.log('Getting distance matrix for', locationIds.length, 'locations')
    const distanceMatrix = await getFullDistanceMatrix(locationIds, {
      format: 'array',
      force: true,
    })

    // Create worker and get result
    const worker = new Worker(path.resolve(process.cwd(), 'src/app/api/schedule/worker.js'))
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate()
        reject(new Error('Worker timed out'))
      }, 30000)

      worker.on('message', result => {
        clearTimeout(timeout)
        worker.terminate()
        resolve(result)
      })

      worker.on('error', error => {
        clearTimeout(timeout)
        worker.terminate()
        reject(error)
      })

      // Pass the indexed services to worker
      worker.postMessage({ services: validServicesWithIndex, distanceMatrix })
    })

    // Now that we have the result, identify unscheduled services
    const scheduledServiceIds = new Set(result.scheduledServices.map(s => s.id))
    const unscheduledValidServices = validServices
      .filter(s => !scheduledServiceIds.has(s.id))
      .map(service => {
        const reason = determineUnscheduledReason(service, result.scheduledServices)
        console.log('Unscheduled valid service:', service.id, 'Reason:', reason)
        return {
          id: service.id,
          company: service.company,
          location: {
            id: service.location.id,
            address: service.location.address
          },
          time: {
            range: service.time.range,
            duration: service.time.duration
          },
          reason
        }
      })

    console.log('Unscheduled valid services:', unscheduledValidServices.length)

    // When combining unscheduled services, include the missing time range ones
    const unscheduledServices = [...missingTimeRangeServices, ...invalidServices, ...unscheduledValidServices]
    console.log('Total unscheduled services:', unscheduledServices.length)

    const totalConnectedPoints = result.scheduledServices.filter(s => s.cluster >= 0).length
    const totalClusters = new Set(result.scheduledServices.map(s => s.cluster).filter(c => c >= 0)).size

    return {
      ...result,
      initialServices: response.data.length,
      clusteringInfo: {
        algorithm: 'shifts',
        performanceDuration: Math.round(performance.now() - startTime),
        connectedPointsCount: totalConnectedPoints,
        totalClusters,
        clusterDistribution: result.scheduledServices.reduce((acc, service) => {
          if (service.cluster >= 0) {
            const cluster = service.cluster
            acc[cluster] = (acc[cluster] || 0) + 1
          }
          return acc
        }, []),
        techAssignments: result.clusteringInfo?.techAssignments || {},
      },
      schedulingDetails: {
        totalServices: services.length,
        scheduledServices: result.scheduledServices.length,
        unscheduledServices,
        summary: {
          totalUnscheduled: unscheduledServices.length,
          reasonBreakdown: unscheduledServices.reduce((acc, s) => {
            acc[s.reason] = (acc[s.reason] || 0) + 1
            return acc
          }, {})
        }
      }
    }
  } catch (error) {
    console.error('Schedule error:', error)
    throw error
  }
}

function determineUnscheduledReason(service, scheduledServices) {
  // Check for missing location
  if (!service.location?.id) return 'MISSING_LOCATION'

  // Check for invalid time range
  if (!service.time?.range?.[0] || !service.time?.range?.[1]) {
    return 'INVALID_TIME_RANGE'
  }

  // Check for invalid time window (end before start)
  const start = new Date(service.time.range[0])
  const end = new Date(service.time.range[1])
  if (end < start) {
    return 'INVALID_TIME_WINDOW: End time before start time'
  }

  // Check for overlapping services at same location
  const overlappingServices = scheduledServices.filter(s => 
    s.location.id === service.location.id &&
    new Date(s.time.range[0]) <= new Date(service.time.range[1]) &&
    new Date(s.time.range[1]) >= new Date(service.time.range[0])
  )
  if (overlappingServices.length > 0) {
    return 'TIME_OVERLAP_AT_LOCATION'
  }

  // Check if service duration exceeds shift duration
  if (service.time.duration > 480) { // 8 hours in minutes
    return 'EXCEEDS_SHIFT_DURATION'
  }

  // Default reason if no specific condition is met
  return 'NO_VALID_SHIFT_FIT'
}
