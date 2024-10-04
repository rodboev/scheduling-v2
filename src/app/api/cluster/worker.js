import { performance } from 'perf_hooks'
import { parentPort } from 'worker_threads'

const MAX_RADIUS_MILES = 5
const MAX_K_CHANGES = 10000 // Maximum number of times k can be adjusted
const MAX_ITERATIONS = 50000 // Maximum number of iterations for k-means

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
 * @returns {{clusters: number[][], centroids: number[][], k: number, initialClusters: number[][], kChangeCount: number, totalIterations: number}} - Clustering result.
 */
function kMeans({
  points,
  minPoints,
  maxPoints,
  maxIterations = MAX_ITERATIONS,
}) {
  try {
    const startTime = performance.now()
    let k = Math.max(1, Math.ceil(points.length / maxPoints))
    let bestClusters, bestCentroids, bestK, bestCost
    let lowestCost = Infinity
    let kChangeCount = 0
    let totalIterations = 0
    let maxIterationsReached = false
    let currentClusters, currentCentroids, currentCost

    while (kChangeCount < MAX_K_CHANGES && totalIterations < MAX_ITERATIONS) {
      let iterations = 0
      let previousCost = Infinity

      // Initialize centroids
      currentCentroids = Array.from({ length: k }, () => {
        const randomIndex = Math.floor(Math.random() * points.length)
        return points[randomIndex]
      })

      while (iterations < maxIterations && totalIterations < MAX_ITERATIONS) {
        currentClusters = Array.from({ length: k }, () => [])

        // Assign points to clusters
        for (let i = 0; i < points.length; i++) {
          let nearestCentroidIndex = 0
          let minDistance = Infinity

          for (let j = 0; j < k; j++) {
            const distance = Math.hypot(
              currentCentroids[j][0] - points[i][0],
              currentCentroids[j][1] - points[i][1],
            )
            if (distance < minDistance) {
              minDistance = distance
              nearestCentroidIndex = j
            }
          }

          currentClusters[nearestCentroidIndex].push(i)
        }

        // Recalculate centroids
        currentCentroids = currentClusters.map(cluster => {
          if (cluster.length === 0)
            return currentCentroids[Math.floor(Math.random() * k)]
          const sum = [0, 0]
          for (const pointIndex of cluster) {
            sum[0] += points[pointIndex][0]
            sum[1] += points[pointIndex][1]
          }
          return [sum[0] / cluster.length, sum[1] / cluster.length]
        })

        // Calculate cost (sum of squared distances)
        currentCost = 0
        for (let i = 0; i < k; i++) {
          for (const pointIndex of currentClusters[i]) {
            currentCost += Math.pow(
              Math.hypot(
                currentCentroids[i][0] - points[pointIndex][0],
                currentCentroids[i][1] - points[pointIndex][1],
              ),
              2,
            )
          }
        }

        // Check for convergence
        if (Math.abs(currentCost - previousCost) < 1e-6) {
          break
        }

        previousCost = currentCost
        iterations++
        totalIterations++
      }

      // Check if this clustering satisfies minPoints and maxPoints constraints
      const clusterSizes = currentClusters.map(cluster => cluster.length)
      const maxClusterSize = Math.max(...clusterSizes)
      const minClusterSize = Math.min(...clusterSizes)

      if (minClusterSize >= minPoints && maxClusterSize <= maxPoints) {
        // This clustering satisfies the constraints
        if (currentCost < lowestCost) {
          lowestCost = currentCost
          bestClusters = currentClusters
          bestCentroids = currentCentroids
          bestK = k
          bestCost = currentCost
        }
      }

      // Adjust k based on cluster sizes
      if (maxClusterSize > maxPoints) {
        k++
      } else if (minClusterSize < minPoints && k > 1) {
        k--
      } else {
        // If we've found a valid clustering, we can stop
        if (bestClusters) break
        // Otherwise, slightly adjust k to keep searching
        k += Math.random() < 0.5 ? 1 : -1
        k = Math.max(1, k)
      }

      kChangeCount++
    }

    if (totalIterations >= MAX_ITERATIONS) {
      const runtime = performance.now() - startTime
      console.warn(
        `❌ MAX_ITERATIONS (${MAX_ITERATIONS}) reached, K_CHANGES is ${kChangeCount}, runtime ${runtime.toPrecision(3)}ms`,
      )
      maxIterationsReached = true
    }
    if (kChangeCount >= MAX_K_CHANGES) {
      const runtime = performance.now() - startTime
      console.warn(
        `❌ MAX_K_CHANGES (${MAX_K_CHANGES}) reached, ITERATIONS is ${totalIterations}, runtime ${runtime.toPrecision(2)}ms`,
      )
    }

    // If we couldn't find a clustering that satisfies the constraints, use the last one we found
    if (!bestClusters) {
      bestClusters = currentClusters
      bestCentroids = currentCentroids
      bestK = k
      bestCost = currentCost
    }

    // Ensure that clusters are numbered from 0 to k-1
    const finalClusters = bestClusters.filter(cluster => cluster.length > 0)
    const clusterMapping = {}
    finalClusters.forEach((cluster, index) => {
      cluster.forEach(pointIndex => {
        clusterMapping[pointIndex] = index
      })
    })

    return {
      clusters: points.map((_, index) => clusterMapping[index] ?? -1),
      centroids: bestCentroids,
      k: finalClusters.length,
      kChangeCount,
      totalIterations,
      clusterSizes: finalClusters.map(cluster => cluster.length),
      cost: bestCost,
      maxIterationsReached,
    }
  } catch (error) {
    console.error('Error in kMeans function:', error)
    throw error
  }
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

      const { connectedPoints, outliers } = filterOutliers(
        points,
        distanceMatrix,
      )

      const filteredPoints = connectedPoints.map(index => points[index])
      const filteredDistanceMatrix = connectedPoints.map(i =>
        connectedPoints.map(j => distanceMatrix[i][j]),
      )

      let clusteredServices
      let clusteringInfo = {
        algorithm,
        connectedPointsCount: connectedPoints.length,
        outlierCount: outliers.length,
        maxDistance: Number(maxDistance.toPrecision(3)),
        minDistance: Number(minDistance.toPrecision(3)),
        avgDistance: Number(avgDistance.toPrecision(3)),
        sampleMatrix: sampleMatrix,
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
          clusterSizes: clusters.map(cluster => cluster.length),
        }
      } else if (algorithm === 'kmeans') {
        const {
          clusters,
          centroids,
          k,
          kChangeCount,
          totalIterations,
          clusterSizes,
          cost,
          maxIterationsReached,
        } = kMeans({
          points: filteredPoints,
          minPoints,
          maxPoints,
        })

        clusteredServices = services.map((service, index) => {
          if (outliers.includes(index)) {
            return { ...service, cluster: -2, wasStatus: 'outlier' }
          }
          const filteredIndex = connectedPoints.indexOf(index)
          return {
            ...service,
            cluster: filteredIndex !== -1 ? clusters[filteredIndex] : -1,
          }
        })

        clusteringInfo = {
          ...clusteringInfo,
          k,
          kChangeCount,
          totalIterations,
          clusterSizes,
          cost,
          maxIterationsReached,
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
        totalClusters: clusteringInfo.clusterSizes?.length || 0,
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
        clusteringInfo: {
          algorithm,
        },
      })
    }
  },
)

// Add a listener for the 'terminate' event
parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
