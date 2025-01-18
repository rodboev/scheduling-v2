import fs from 'fs'

const before = JSON.parse(fs.readFileSync('schedule-before.json', 'utf8'))
const after = JSON.parse(fs.readFileSync('schedule-after.json', 'utf8'))

// Group services by tech
const beforeByTech = {}
const afterByTech = {}

before.scheduledServices.forEach(service => {
  if (!beforeByTech[service.techId]) beforeByTech[service.techId] = []
  beforeByTech[service.techId].push(service)
})

after.scheduledServices.forEach(service => {
  if (!afterByTech[service.techId]) afterByTech[service.techId] = []
  afterByTech[service.techId].push(service)
})

// Analyze changes for each tech
Object.keys(beforeByTech).forEach(techId => {
  const beforeServices = beforeByTech[techId]
  const afterServices = afterByTech[techId]

  if (!afterServices) {
    console.log(`Tech ${techId} missing from after schedule!`)
    return
  }

  console.log(`\nAnalyzing ${techId}:`)
  console.log('Before:', beforeServices.length, 'services')
  console.log('After:', afterServices.length, 'services')

  // Compare service times
  beforeServices.forEach(beforeService => {
    const afterService = afterServices.find(s => s.id === beforeService.id)
    if (!afterService) {
      console.log(`Service ${beforeService.id} missing from after schedule!`)
      return
    }

    const beforeStart = new Date(beforeService.start)
    const afterStart = new Date(afterService.start)
    const timeDiff = (afterStart - beforeStart) / (60 * 1000) // in minutes

    if (Math.abs(timeDiff) > 1) { // Only show changes > 1 minute
      console.log(
        `Service ${beforeService.id} moved by ${Math.round(timeDiff)} minutes`,
        timeDiff > 0 ? 'later' : 'earlier'
      )
    }
  })

  // Calculate gaps
  const calculateGaps = services => {
    const gaps = []
    for (let i = 1; i < services.length; i++) {
      const prevEnd = new Date(services[i-1].end)
      const currentStart = new Date(services[i].start)
      const gap = (currentStart - prevEnd) / (60 * 1000) // in minutes
      if (gap > 15) { // Only count gaps > 15 minutes
        gaps.push(gap)
      }
    }
    return gaps
  }

  const beforeGaps = calculateGaps(beforeServices)
  const afterGaps = calculateGaps(afterServices)

  if (beforeGaps.length > 0 || afterGaps.length > 0) {
    console.log('\nGaps analysis:')
    if (beforeGaps.length > 0) {
      console.log('Before:', beforeGaps.length, 'gaps,', 
        'Average:', Math.round(beforeGaps.reduce((a,b) => a+b, 0) / beforeGaps.length), 'minutes')
    }
    if (afterGaps.length > 0) {
      console.log('After:', afterGaps.length, 'gaps,',
        'Average:', Math.round(afterGaps.reduce((a,b) => a+b, 0) / afterGaps.length), 'minutes')
    }
  }
}) 