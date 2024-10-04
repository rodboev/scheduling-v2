import { performance } from 'perf_hooks'
import { parentPort } from 'worker_threads'

const MAX_RADIUS_MILES = 5
const MAX_K_CHANGES = 100 // Maximum number of times k can be adjusted
const MAX_ITERATIONS = 1000 // Maximum number of iterations for k-means
const MAX_EXECUTION_TIME = 30000 // Maximum execution time in milliseconds (30 seconds)

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

function DBSCAN({ points, distanceMatrix, maxPoints, clusterUnclustered }) {
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
        queue.push(...currentNeighbors.filter(n => !visited.has(n)))
      }
    }

    return cluster
  }

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue
    visited.add(i)

    const neighbors = getNeighbors(i)
    if (neighbors.length > 0) {
      const cluster = expandCluster(i, neighbors)
      if (cluster.length > 1) {
        clusters.push(cluster)
      } else {
        noise.add(i)
        initialStatus.set(i, 'noise')
      }
    } else {
      noise.add(i)
      initialStatus.set(i, 'noise')
    }
  }

  if (clusterUnclustered) {
    Array.from(noise).forEach(pointIndex => {
      let nearestCluster = -1
      let minDistance = Infinity

      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i]
        for (let j = 0; j < cluster.length; j++) {
          const distance = distanceMatrix[pointIndex][cluster[j]]
          if (distance < minDistance) {
            minDistance = distance
            nearestCluster = i
          }
        }
      }

      if (nearestCluster !== -1) {
        clusters[nearestCluster].push(pointIndex)
        noise.delete(pointIndex)
      }
    })
  }

  return { clusters, noise, initialStatus }
}

function kMeans({ points, maxPoints, maxIterations = MAX_ITERATIONS }) {
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

    initialClusters = clusters.map(cluster => [...cluster])

    const tooLargeClusters = clusters.filter(
      cluster => cluster.length > maxPoints,
    )

    allClustersWithinLimits = tooLargeClusters.length === 0

    if (!allClustersWithinLimits) {
      k++
      kChangeCount++
    }
  }

  return { clusters, centroids, k, initialClusters, kChangeCount }
}

parentPort.on(
  'message',
  ({
    services,
    distanceMatrix,
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
      parentPort.postMessage({
        error: error.message,
      })
    }

    if (performance.now() - startTime > MAX_EXECUTION_TIME) {
      parentPort.postMessage({
        error: 'Clustering operation timed out',
      })
    }
  },
)
