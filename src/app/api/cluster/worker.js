import { parentPort } from 'worker_threads'

function customDBSCAN({
  points,
  distanceMatrix,
  maxPointsPerCluster,
  minPoints,
  clusterUnclustered,
}) {
  const clusters = []
  const visited = new Set()
  const noise = new Set()
  const initialNoise = new Set() // New set to keep track of initial noise points

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

    return cluster
  }

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue
    visited.add(i)

    const neighbors = getNeighbors(i)
    if (neighbors.length >= minPoints - 1) {
      const cluster = expandCluster(i, neighbors)
      if (cluster.length >= minPoints) {
        clusters.push(cluster)
      } else {
        cluster.forEach(point => {
          noise.add(point)
          initialNoise.add(point) // Add to initialNoise as well
        })
      }
    } else {
      noise.add(i)
      initialNoise.add(i) // Add to initialNoise as well
    }
  }

  // Assign unclustered points to the nearest cluster if clusterUnclustered is true
  if (clusterUnclustered) {
    Array.from(noise).forEach(pointIndex => {
      let nearestCluster = -1
      let minDistance = Infinity

      clusters.forEach((cluster, clusterIndex) => {
        cluster.forEach(clusterPointIndex => {
          const distance = distanceMatrix[pointIndex][clusterPointIndex]
          if (distance < minDistance) {
            minDistance = distance
            nearestCluster = clusterIndex
          }
        })
      })

      if (nearestCluster !== -1) {
        clusters[nearestCluster].push(pointIndex)
        noise.delete(pointIndex)
        // Note: We don't remove from initialNoise
      }
    })
  }

  return { clusters, noise, initialNoise }
}

parentPort.on(
  'message',
  ({
    services,
    distanceMatrix,
    maxPointsPerCluster,
    minPoints,
    clusterUnclustered,
  }) => {
    const points = services.map((_, index) => [index])

    const { clusters, noise, initialNoise } = customDBSCAN({
      points,
      distanceMatrix,
      maxPointsPerCluster,
      minPoints,
      clusterUnclustered,
    })

    const clusteredServices = services.map((service, index) => ({
      ...service,
      cluster: clusters.findIndex(cluster => cluster.includes(index)),
      wasNoise: initialNoise.has(index), // Use initialNoise instead of noise
    }))

    parentPort.postMessage(clusteredServices)
  },
)
