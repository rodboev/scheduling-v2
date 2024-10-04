import { parentPort } from 'worker_threads'

const MAX_RADIUS_MILES = 5

function filterOutliers(points, distanceMatrix) {
  const connectedPoints = []
  const outliers = []

  for (let i = 0; i < points.length; i++) {
    let hasNearbyPoint = false
    for (let j = 0; j < points.length; j++) {
      if (i !== j && distanceMatrix[i][j] <= MAX_RADIUS_MILES) {
        hasNearbyPoint = true
        break
      }
    }
    if (hasNearbyPoint) {
      connectedPoints.push(i)
    } else {
      outliers.push(i)
    }
  }

  return { connectedPoints, outliers }
}

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
  const initialStatus = new Map()

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
          initialStatus.set(point, 'noise')
        })
      }
    } else {
      noise.add(i)
      initialStatus.set(i, 'noise')
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

  return { clusters, noise, initialStatus }
}

function kMeans({ points, maxPoints, maxIterations = 100 }) {
  let k = Math.max(1, Math.ceil(points.length / maxPoints))
  let clusters, centroids, initialClusters
  let allClustersWithinLimit = false

  while (!allClustersWithinLimit) {
    // Initialize centroids randomly
    let centroids = Array.from({ length: k }, () => {
      const randomIndex = Math.floor(Math.random() * points.length)
      return points[randomIndex]
    })

    clusters = []
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

    initialClusters = clusters.map(cluster => [...cluster])

    // Check if all clusters are within the maxPoints limit
    allClustersWithinLimit = clusters.every(
      cluster => cluster.length <= maxPoints,
    )

    if (!allClustersWithinLimit) {
      k++ // Increase k if any cluster exceeds maxPoints
    }
  }

  return { clusters, centroids, k, initialClusters }
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

    // Calculate max, min, and avg distances
    const flatDistances = distanceMatrix
      .flat()
      .filter(d => d !== null && d !== 0)
    const maxDistance = Math.max(...flatDistances)
    const minDistance = Math.min(...flatDistances)
    const avgDistance =
      flatDistances.reduce((a, b) => a + b, 0) / flatDistances.length

    // Sample matrix info
    const sampleSize = Math.min(5, distanceMatrix.length)
    const sampleMatrix = distanceMatrix
      .slice(0, sampleSize)
      .map(row => row.slice(0, sampleSize))

    let clusteringInfo = {
      connectedPointsCount: 0,
      outlierCount: 0,
      maxDistance: Number(maxDistance.toPrecision(3)),
      minDistance: Number(minDistance.toPrecision(3)),
      avgDistance: Number(avgDistance.toPrecision(3)),
      sampleMatrix: sampleMatrix,
    }

    const { connectedPoints, outliers } = filterOutliers(points, distanceMatrix)

    const filteredPoints = connectedPoints.map(index => points[index])
    const filteredDistanceMatrix = connectedPoints.map(i =>
      connectedPoints.map(j => distanceMatrix[i][j]),
    )

    let clusteredServices

    clusteringInfo = {
      ...clusteringInfo,
      connectedPointsCount: connectedPoints.length,
      outlierCount: outliers.length,
    }

    if (algorithm === 'dbscan') {
      const { clusters, initialStatus } = DBSCAN({
        points: filteredPoints,
        distanceMatrix: filteredDistanceMatrix,
        maxPoints,
        minPoints,
        clusterUnclustered,
      })

      clusteredServices = services.map((service, index) => {
        if (outliers.includes(index)) {
          return { ...service, cluster: -2, wasStatus: 'outlier' }
        }
        const filteredIndex = connectedPoints.indexOf(index)
        const clusterIndex = clusters.findIndex(cluster =>
          cluster.includes(filteredIndex),
        )
        return {
          ...service,
          cluster: clusterIndex !== -1 ? clusterIndex : -1,
          wasStatus: initialStatus.get(filteredIndex) ?? clusterIndex,
        }
      })

      clusteringInfo = {
        ...clusteringInfo,
        algorithm: 'DBSCAN',
        clusterSizes: clusters.map(cluster => cluster.length),
      }
    } else if (algorithm === 'kmeans') {
      const { clusters, centroids, k, initialClusters } = kMeans({
        points: filteredPoints,
        maxPoints,
      })

      clusteredServices = services.map((service, index) => {
        if (outliers.includes(index)) {
          return { ...service, cluster: -2, wasStatus: 'outlier' }
        }
        const filteredIndex = connectedPoints.indexOf(index)
        const clusterIndex = clusters.findIndex(cluster =>
          cluster.includes(filteredIndex),
        )
        const initialClusterIndex = initialClusters.findIndex(cluster =>
          cluster.includes(filteredIndex),
        )
        return {
          ...service,
          cluster: clusterIndex,
        }
      })

      clusteringInfo = {
        ...clusteringInfo,
        algorithm: 'K-means',
        k,
        clusterSizes: clusters.map(cluster => cluster.length),
      }
    } else {
      throw new Error('Invalid clustering algorithm specified')
    }

    // Calculate additional statistics
    const clusterCounts = clusteredServices.reduce((acc, service) => {
      acc[service.cluster] = (acc[service.cluster] || 0) + 1
      return acc
    }, {})

    clusteringInfo = {
      ...clusteringInfo,
      totalClusters: clusteringInfo.clusterSizes.length,
      noisePoints: clusterCounts['-1'] || 0,
      outliersCount: clusterCounts['-2'] || 0,
      clusterDistribution: Object.entries(clusterCounts).map(
        ([cluster, count]) => ({ [cluster]: count }),
      ),
      outliers: clusteredServices
        .filter(service => service.cluster === -2)
        .map(service => ({
          company: service.company,
          latitude: service.location.latitude,
          longitude: service.location.longitude,
        })),
    }

    parentPort.postMessage({
      clusteredServices,
      clusteringInfo,
    })
  },
)
