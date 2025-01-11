import fetch from 'node-fetch'

async function testScheduleOptimization() {
  console.log('Testing schedule optimization...')
  
  const response = await fetch('http://localhost:3000/api/schedule?start=2025-01-06T05:00:00.000Z&end=2025-01-07T05:00:00.000Z')
  const data = await response.json()
  
  const uniqueTechs = new Set(data.scheduledServices.map(service => service.techId))
  console.log('Number of unique techs:', uniqueTechs.size)
  console.log('Total services:', data.scheduledServices.length)
  console.log('Services per tech (avg):', (data.scheduledServices.length / uniqueTechs.size).toFixed(2))
  console.log('\nClustering Info:', data.clusteringInfo)
}

testScheduleOptimization() 