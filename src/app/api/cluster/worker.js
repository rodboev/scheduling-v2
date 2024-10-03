import { parentPort } from 'worker_threads'

function DBSCAN({
  points,
  distanceMatrix,
  maxPoints,
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
      .slice(0, maxPoints - 1)
  }

  function expandCluster(point, neighbors) {
    const cluster = [point]
    const queue = [...neighbors]

    while (queue.length > 0 && cluster.length < maxPoints) {
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

function kMeans({ points, maxIterations = 100 }) {
  const k = 3 // Fixed k value

  console.log(`K-means: Using k = ${k}`)

  // Initialize centroids randomly
  let centroids = Array.from({ length: k }, () => {
    const randomIndex = Math.floor(Math.random() * points.length)
    return points[randomIndex]
  })

  let clusters = []
  let iterations = 0

  while (iterations < maxIterations) {
    // Assign points to nearest centroid
    clusters = Array.from({ length: k }, () => [])

    for (const [index, point] of points.entries()) {
      let nearestCentroidIndex = 0
      let minDistance = Infinity

      for (let i = 0; i < k; i++) {
        const distance = Math.sqrt(
          centroids[i].reduce((sum, coord, dim) => {
            return sum + Math.pow(coord - point[dim], 2)
          }, 0),
        )
        if (distance < minDistance) {
          minDistance = distance
          nearestCentroidIndex = i
        }
      }

      clusters[nearestCentroidIndex].push(index)
    }

    // Recalculate centroids
    const newCentroids = clusters.map(cluster => {
      if (cluster.length === 0) return centroids[0] // Avoid empty clusters
      return cluster
        .reduce((sum, pointIndex) => {
          return sum.map((coord, dim) => coord + points[pointIndex][dim])
        }, new Array(points[0].length).fill(0))
        .map(coord => coord / cluster.length)
    })

    // Check for convergence
    if (JSON.stringify(newCentroids) === JSON.stringify(centroids)) {
      break
    }

    centroids = newCentroids
    iterations++
  }

  return { clusters, centroids, k }
}

parentPort.on(
  'message',
  ({
    services,
    distanceMatrix,
    maxPoints,
    minPoints,
    clusterUnclustered,
    algorithm = 'kmeans',
  }) => {
    const points = services.map(service => [
      service.location.latitude,
      service.location.longitude,
    ])

    let clusteredServices

    if (algorithm === 'dbscan') {
      const { clusters, initialNoise } = DBSCAN({
        points,
        distanceMatrix,
        maxPoints,
        minPoints,
        clusterUnclustered,
      })

      clusteredServices = services.map((service, index) => ({
        ...service,
        cluster: clusters.findIndex(cluster => cluster.includes(index)),
        wasNoise: initialNoise.has(index),
      }))
    } else if (algorithm === 'kmeans') {
      const { clusters, centroids, k } = kMeans({ points })

      clusteredServices = services.map((service, index) => {
        const clusterIndex = clusters.findIndex(cluster =>
          cluster.includes(index),
        )
        return {
          ...service,
          cluster: clusterIndex,
          wasNoise: false, // K-means doesn't produce noise points
        }
      })

      // Log clustering results
      console.log('K-means Clustering Results:')
      console.log(`Used k: ${k}`)
      console.log(`Number of clusters: ${clusters.length}`)
      clusters.forEach((cluster, index) => {
        console.log(`Cluster ${index}: ${cluster.length} points`)
      })
    } else {
      throw new Error('Invalid clustering algorithm specified')
    }

    parentPort.postMessage(clusteredServices)
  },
)
