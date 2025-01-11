(async () => {
  const response = await fetch('http://localhost:3000/api/schedule?start=2025-01-06T05:00:00.000Z&end=2025-01-07T05:00:00.000Z')
  const data = await response.json()

  console.log(`Services: ${data.scheduledServices.length}`)
  console.log(`Techs: ${new Set(data.scheduledServices.map(service => service.techId)).size}`)
})()
