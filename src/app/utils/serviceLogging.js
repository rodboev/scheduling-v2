import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

// Format service time for logging
export const formatServiceTime = service => {
  const start = new Date(service.start)
  const end = new Date(service.end)
  const date = start.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  const startTime = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const endTime = end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const rangeStart = new Date(service.time.range[0])
  const rangeEnd = new Date(service.time.range[1])
  const rangeStartTime = rangeStart.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const rangeEndTime = rangeEnd.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `(${service.sequenceNumber || '?'}) ${date} ${startTime}-${endTime}, ${service.company} (${service.location.latitude}, ${service.location.longitude}) (range: ${rangeStartTime}-${rangeEndTime})`
}

export function logClusterServices(clusterServices) {
  const firstService = clusterServices[0]
  const lastService = clusterServices[clusterServices.length - 1]
  const startTime = new Date(firstService.start).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const endTime = new Date(lastService.end).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  console.log(`Cluster ${firstService.cluster} (${startTime} - ${endTime}):`)

  // Log cluster services
  for (const [i, service] of clusterServices.entries()) {
    const distance = service.distanceFromPrevious || 0
    const travelTime = service.travelTimeFromPrevious || 0

    let line = formatServiceTime(service)
    if (i > 0) {
      line += ` (${distance.toFixed(2)} mi / ${travelTime} min from ${service.previousCompany})`
    }
    console.log(line)
  }

  // Print cluster stats
  const distances = clusterServices
    .filter(s => s.distanceFromPrevious !== undefined)
    .map(s => s.distanceFromPrevious)

  const travelTimes = clusterServices
    .filter(s => s.travelTimeFromPrevious !== undefined)
    .map(s => s.travelTimeFromPrevious)

  const totalDistance = distances.length > 0 ? distances.reduce((sum, d) => sum + d, 0) : 0
  const totalTravelTime = travelTimes.length > 0 ? travelTimes.reduce((sum, t) => sum + t, 0) : 0

  console.log(`Distance: ${totalDistance.toFixed(2)} mi`)
  console.log(`Travel time: ${totalTravelTime} min\n`)
}

export function logTechServices(techServices) {
  if (!techServices?.length) return

  // Sort services by start time first, then by sequence number if times are equal
  const sortedServices = [...techServices].sort((a, b) => {
    const timeA = new Date(a.start).getTime()
    const timeB = new Date(b.start).getTime()
    return timeA - timeB
  })

  const firstService = sortedServices[0]
  const lastService = sortedServices[sortedServices.length - 1]

  // Format times
  const startTime = dayjs(firstService.start).format('h:mm A')
  const endTime = dayjs(lastService.end).format('h:mm A')

  // Log tech header
  console.log(`${firstService.techId} (${startTime} - ${endTime}):`)

  // Track overlapping services
  const overlappingGroups = []
  let currentGroup = []

  // Log tech services in scheduled order
  for (const [i, service] of sortedServices.entries()) {
    if (!service.start || !service.end || !service.location) continue

    // Check if this service overlaps with any in the current group
    const serviceStart = new Date(service.start).getTime()
    const serviceEnd = new Date(service.end).getTime()
    
    const overlapsWithCurrent = currentGroup.some(s => {
      const existingStart = new Date(s.start).getTime()
      const existingEnd = new Date(s.end).getTime()
      return (serviceStart < existingEnd && serviceEnd > existingStart)
    })

    if (overlapsWithCurrent) {
      currentGroup.push(service)
    } else {
      if (currentGroup.length > 1) {
        overlappingGroups.push([...currentGroup])
      }
      currentGroup = [service]
    }

    const startTime = dayjs(service.start).format('h:mm A')
    const endTime = dayjs(service.end).format('h:mm A')
    const distance = service.distanceFromPrevious?.toFixed(1) || '0.0'
    const travelTime = service.travelTimeFromPrevious || 0
    const location = service.location ? 
      `(${service.location.latitude.toFixed(3)}, ${service.location.longitude.toFixed(3)})` : ''
    
    const prevService = i > 0 ? sortedServices[i - 1] : null
    const travelInfo = prevService && !overlapsWithCurrent
      ? ` (${distance} mi, ${travelTime}m from ${prevService.company})`
      : ''
    
    const conflictWarning = overlapsWithCurrent ? ' ⚠️ CONFLICT' : ''
    
    console.log(
      `  ${i + 1}. ${startTime} - ${endTime} - ${service.company} ${location}${travelInfo}${conflictWarning}`,
    )
  }

  // Check last group
  if (currentGroup.length > 1) {
    overlappingGroups.push([...currentGroup])
  }

  // Log conflicts summary if any exist
  if (overlappingGroups.length > 0) {
    console.log('\n  ⚠️ Scheduling Conflicts:')
    for (const [index, group] of overlappingGroups.entries()) {
      console.log(`  Conflict Group ${index + 1}:`)
      for (const service of group) {
        const time = `${dayjs(service.start).format('h:mm A')} - ${dayjs(service.end).format('h:mm A')}`
        console.log(`    - ${time} ${service.company}`)
      }
    }
  }

  console.log('')
}

export function logScheduleActivity({ services, clusteringInfo }) {
  if (!services?.length) {
    console.log('No services to log')
    return
  }

  // Group services by tech, only including valid scheduled services
  const servicesByTech = new Map()
  const scheduledServices = services.filter(s => (
    s.techId && 
    s.start && 
    s.end && 
    s.location &&
    !isNaN(new Date(s.start).getTime()) && // Ensure valid dates
    !isNaN(new Date(s.end).getTime())
  ))

  for (const service of scheduledServices) {
    if (!servicesByTech.has(service.techId)) {
      servicesByTech.set(service.techId, [])
    }
    servicesByTech.get(service.techId).push(service)
  }

  // Sort techs numerically
  const sortedTechIds = [...servicesByTech.keys()].sort((a, b) => {
    const numA = parseInt(a.replace('Tech ', ''))
    const numB = parseInt(b.replace('Tech ', ''))
    return numA - numB
  })

  // Log tech details
  console.log('\nTech Details:')
  for (const techId of sortedTechIds) {
    const services = servicesByTech.get(techId)
    logTechServices(services)
  }

  // Log performance metrics at the end
  console.log('\nScheduling Performance:')
  console.log(`Runtime: ${clusteringInfo.performanceDuration}ms`)
  console.log(`Total techs: ${servicesByTech.size}`)
  console.log(`Scheduled services: ${scheduledServices.length}`)
}
