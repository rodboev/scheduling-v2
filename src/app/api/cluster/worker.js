import { DBSCAN } from 'density-clustering'
import { parentPort } from 'worker_threads'

parentPort.on('message', ({ services, distanceMatrix, epsilon, minPoints }) => {
  const dbscan = new DBSCAN()
  const points = services.map((_, index) => [index]) // Use indices as points

  const clusters = dbscan.run(
    points,
    epsilon,
    minPoints,
    (a, b) => distanceMatrix[a[0]][b[0]], // Use indices to access distance matrix
  )

  const clusteredServices = services.map((service, index) => ({
    ...service,
    cluster: clusters.find(cluster => cluster.includes(index))
      ? clusters.findIndex(cluster => cluster.includes(index))
      : -1,
  }))

  parentPort.postMessage(clusteredServices)
})
