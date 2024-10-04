import { performance } from 'perf_hooks'
import { parentPort } from 'worker_threads'

const MAX_RADIUS_MILES = 5
const MAX_K_CHANGES = 5000 // Maximum number of times k can be adjusted
const MAX_ITERATIONS = 1000 // Maximum number of iterations for k-means

/**
 * Filters out outliers from the given points based on the distance matrix.
 * @param {number[][]} points - Array of [latitude, longitude] coordinates.
 * @param {number[][]} distanceMatrix - Matrix of distances between points.
 * @returns {{connectedPoints: number[], outliers: number[]}} - Indices of connected points and outliers.
 *
 * This function identifies points that have at least one neighbor within MAX_RADIUS_MILES.
 * Points without nearby neighbors are considered outliers.
 */
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

/**
 * Performs DBSCAN clustering on the given points.
 * @param {Object} params - The parameters for DBSCAN.
 * @param {number[][]} params.points - Array of [latitude, longitude] coordinates.
 * @param {number[][]} params.distanceMatrix - Matrix of distances between points.
 * @param {number} params.minPoints - Minimum number of points to form a cluster.
 * @param {number} params.maxPoints - Maximum number of points in a cluster.
 * @param {boolean} params.clusterUnclustered - Whether to assign unclustered points to the nearest cluster.
 * @returns {{clusters: number[][], noise: Set<number>, initialStatus: Map<number, string>}} - Clustering result.
 *
 * This function implements the DBSCAN algorithm. It forms clusters based on density,
 * identifies noise points, and optionally assigns unclustered points to the nearest cluster.
 */
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

/**
 * Performs K-means clustering on the given points.
 * @param {Object} params - The parameters for K-means.
 * @param {number[][]} params.points - Array of [latitude, longitude] coordinates.
 * @param {number} params.minPoints - Minimum number of points in a cluster.
 * @param {number} params.maxPoints - Maximum number of points in a cluster.
 * @param {number} [params.maxIterations=MAX_ITERATIONS] - Maximum number of iterations.
 * @returns {{clusters: number[][], centroids: number[][], k: number, initialClusters: number[][], kChangeCount: number}} - Clustering result.
 *
 * This function implements the K-means algorithm with dynamic adjustment of k.
 * It starts with an initial k and adjusts it based on cluster sizes until all clusters
 * are within the specified size limits or MAX_K_CHANGES is reached.
 */
function kMeans({
  points,
  minPoints,
  maxPoints,
  maxIterations = MAX_ITERATIONS,
}) {
  let k = Math.max(1, Math.ceil(points.length / maxPoints))
  let clusters, centroids, initialClusters
  let allClustersWithinLimits = false
  let kChangeCount = 0

  while (!allClustersWithinLimits && kChangeCount < MAX_K_CHANGES) {
    centroids = Array.from({ length: k }, () => {
      const randomIndex = Math.floor(Math.random() * points.length)
      return points[randomIndex]
    })

    clusters = []
    let iterations = 0
    let previousCentroids = null

    while (iterations < maxIterations) {
      clusters = Array.from({ length: k }, () => [])

      for (let i = 0; i < points.length; i++) {
        let nearestCentroidIndex = 0
        let minDistance = Infinity

        for (let j = 0; j < k; j++) {
          const distance = Math.hypot(
            centroids[j][0] - points[i][0],
            centroids[j][1] - points[i][1],
          )
          if (distance < minDistance) {
            minDistance = distance
            nearestCentroidIndex = j
          }
        }

        clusters[nearestCentroidIndex].push(i)
      }

      previousCentroids = centroids
      centroids = clusters.map(cluster => {
        if (cluster.length === 0) return previousCentroids[0]
        const sum = [0, 0]
        for (const pointIndex of cluster) {
          sum[0] += points[pointIndex][0]
          sum[1] += points[pointIndex][1]
        }
        return [sum[0] / cluster.length, sum[1] / cluster.length]
      })

      if (JSON.stringify(centroids) === JSON.stringify(previousCentroids)) {
        break
      }

      iterations++
    }

    if (iterations === maxIterations) {
      console.warn(
        `MAX_ITERATIONS (${MAX_ITERATIONS}) reached in k-means algorithm`,
      )
    }

    initialClusters = clusters.map(cluster => [...cluster])

    const tooLargeClusters = clusters.filter(
      cluster => cluster.length > maxPoints,
    )
    const tooSmallClusters = clusters.filter(
      cluster => cluster.length < minPoints,
    )

    allClustersWithinLimits =
      tooLargeClusters.length === 0 && tooSmallClusters.length === 0

    if (!allClustersWithinLimits) {
      if (tooLargeClusters.length > 0) {
        k++
      } else if (tooSmallClusters.length > 0) {
        k = Math.max(1, k - 1)
      }
      kChangeCount++
    }

    if (kChangeCount === MAX_K_CHANGES - 1) {
      console.warn('MAX_K_CHANGES reached in k-means algorithm')
    }
  }

  return { clusters, centroids, k, initialClusters, kChangeCount }
}

parentPort.on(
  'message',
  ({
    services,
    distanceMatrix,
    minPoints,
    maxPoints,
    clusterUnclustered,
    algorithm = 'kmeans',
  }) => {
    const startTime = performance.now()

    try {
      const points = services.map(service => [
        service.location.latitude,
        service.location.longitude,
      ])

      const flatDistances = distanceMatrix
        .flat()
        .filter(d => d !== null && d !== 0)
      const maxDistance = Math.max(...flatDistances)
      const minDistance = Math.min(...flatDistances)
      const avgDistance =
        flatDistances.reduce((a, b) => a + b, 0) / flatDistances.length

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

      const { connectedPoints, outliers } = filterOutliers(
        points,
        distanceMatrix,
      )

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
          minPoints,
          maxPoints,
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
        const { clusters, centroids, k, initialClusters, kChangeCount } =
          kMeans({
            points: filteredPoints,
            minPoints,
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
          return {
            ...service,
            cluster: clusterIndex,
          }
        })

        clusteringInfo = {
          ...clusteringInfo,
          algorithm: 'K-means',
          k,
          kChangeCount,
          clusterSizes: clusters.map(cluster => cluster.length),
        }
      } else {
        throw new Error('Invalid clustering algorithm specified')
      }

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

      const endTime = performance.now()
      const duration = endTime - startTime

      clusteringInfo = {
        ...clusteringInfo,
        performanceDuration: duration.toPrecision(3),
      }

      parentPort.postMessage({
        clusteredServices,
        clusteringInfo,
      })
    } catch (error) {
      console.error('Error in clustering worker:', error.message)
      parentPort.postMessage({
        error: error.message,
      })
    }
  },
)

// Add a listener for the 'terminate' event
parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
