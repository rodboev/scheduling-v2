import fetch from 'node-fetch'

async function testScheduleOptimization() {
  console.log('Testing schedule optimization...')
  
  const response = await fetch('http://localhost:3000/api/schedule?start=2025-01-06T05:00:00.000Z&end=2025-01-07T05:00:00.000Z')
  const data = await response.json()
  
  // Get actual unique tech count from scheduledServices
  const actualUniqueTechs = new Set(data.scheduledServices.map(service => service.techId)).size
  console.log('Actual number of unique techs:', actualUniqueTechs)
  console.log('Total services:', data.scheduledServices.length)
  console.log('Services per tech (avg):', (data.scheduledServices.length / actualUniqueTechs).toFixed(2))
  console.log('\nClustering Info:', data.clusteringInfo)
  
  // Verify the numbers match
  if (actualUniqueTechs !== data.clusteringInfo.totalClusters) {
    console.log('\nWARNING: Mismatch between actual techs and reported clusters!')
    console.log('Actual techs:', actualUniqueTechs)
    console.log('Reported clusters:', data.clusteringInfo.totalClusters)
  }
}

testScheduleOptimization() 