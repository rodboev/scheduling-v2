import { parentPort } from 'worker_threads'

function customDBSCAN(points, distanceMatrix, maxPointsPerCluster, minPoints) {
  const clusters = []
  const visited = new Set()
  const noise = new Set()

  function getNeighbors(pointIndex) {
    return points
      .map((_, index) => index)
      .filter(
        index =>
          index !== pointIndex && distanceMatrix[pointIndex][index] !== null,
      )
      .sort(
        (a, b) => distanceMatrix[pointIndex][a] - distanceMatrix[pointIndex][b],
      )
      .slice(0, maxPointsPerCluster - 1)
  }

  function expandCluster(point, neighbors) {
    const cluster = [point]
    const queue = [...neighbors]

    while (queue.length > 0 && cluster.length < maxPointsPerCluster) {
      const currentPoint = queue.shift()
      if (!visited.has(currentPoint)) {
        visited.add(currentPoint)
        cluster.push(currentPoint)

        const currentNeighbors = getNeighbors(currentPoint)
        if (currentNeighbors.length >= minPoints - 1) {
          queue.push(...currentNeighbors.filter(n => !visited.has(n)))
        }
      }
    }

    return cluster.length >= minPoints ? cluster : []
  }

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue
    visited.add(i)

    const neighbors = getNeighbors(i)
    if (neighbors.length >= minPoints - 1) {
      const cluster = expandCluster(i, neighbors)
      if (cluster.length > 0) {
        clusters.push(cluster)
      }
    } else {
      noise.add(i)
    }
  }

  return clusters
}

parentPort.on(
  'message',
  ({ services, distanceMatrix, maxPointsPerCluster, minPoints }) => {
    const points = services.map((_, index) => [index])

    const clusters = customDBSCAN(
      points,
      distanceMatrix,
      maxPointsPerCluster,
      minPoints,
    )

    const clusteredServices = services.map((service, index) => ({
      ...service,
      cluster: clusters.findIndex(cluster => cluster.includes(index)),
    }))

    parentPort.postMessage(clusteredServices)
  },
)
