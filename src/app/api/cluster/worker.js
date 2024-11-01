import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { getRedisClient } from '../../utils/redis.js'
import { DBSCAN } from './dbscan.js'
import { kMeans } from './kmeans.js'
import { scheduleClusteredServices } from './scheduling.js'

// Constants
const MAX_RADIUS_MILES = 5

async function filterOutliers(points, distanceMatrix) {
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

async function updateRedisClusterInfo(services, clusteringInfo) {
  const redis = getRedisClient()
  const pipeline = redis.pipeline()

  for (const service of services) {
    pipeline.hset(
      `service:${service.id}`,
      'cluster',
      service.cluster,
      'clusterReason',
      service.clusterReason || '',
      'wasStatus',
      service.wasStatus || '',
      'sequenceNumber',
      service.sequenceNumber || -1,
      'time',
      JSON.stringify(service.time),
    )
  }

  // Store clustering info for analytics
  pipeline.hset(
    `clustering:${performance.now()}`,
    'info',
    JSON.stringify(clusteringInfo),
  )

  await pipeline.exec()
}

parentPort.on(
  'message',
  async ({
    services,
    distanceMatrix,
    minPoints,
    maxPoints,
    clusterUnclustered,
    algorithm = 'kmeans',
    distanceBias = 50,
    scheduleOptimization = true,
  }) => {
    try {
      const startTime = performance.now()

      // Extract points for clustering
      const points = services.map(service => [
        service.location.latitude,
        service.location.longitude,
      ])

      // Calculate distance statistics
      const flatDistances = distanceMatrix
        .flat()
        .filter(d => d !== null && d !== 0)
      const maxDistance = Math.max(...flatDistances)
      const minDistance = Math.min(...flatDistances)
      const avgDistance =
        flatDistances.reduce((a, b) => a + b, 0) / flatDistances.length

      // Filter outliers
      const { connectedPoints, outliers } = await filterOutliers(
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
      }

      if (algorithm === 'dbscan') {
        const { clusters, noise, initialStatus } = DBSCAN({
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
            wasStatus: initialStatus.get(filteredIndex),
          }
        })

        clusteringInfo = {
          ...clusteringInfo,
          clusterSizes: clusters.map(cluster => cluster.length),
          noisePoints: noise.size,
          totalClusters: clusters.length,
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
            return { ...service, cluster: -2 }
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
          totalClusters: k,
          centroids,
        }
      }

      // Calculate cluster distribution
      const clusterCounts = clusteredServices.reduce((acc, service) => {
        acc[service.cluster] = (acc[service.cluster] || 0) + 1
        return acc
      }, {})

      clusteringInfo = {
        ...clusteringInfo,
        noisePoints: clusterCounts['-1'] || 0,
        outliersCount: clusterCounts['-2'] || 0,
        clusterDistribution: Object.entries(clusterCounts).map(
          ([cluster, count]) => ({ [cluster]: count }),
        ),
      }

      // Add performance timing
      const endTime = performance.now()
      const duration = endTime - startTime
      clusteringInfo.performanceDuration = Number.parseInt(duration)

      if (scheduleOptimization) {
        const scheduledServices = await scheduleClusteredServices(
          clusteredServices,
          clusterUnclustered,
          distanceBias,
        )

        // Update Redis with clustering and scheduling results
        await updateRedisClusterInfo(scheduledServices, clusteringInfo)

        parentPort.postMessage({ scheduledServices, clusteringInfo })
      } else {
        // Update Redis with just clustering results
        await updateRedisClusterInfo(clusteredServices, clusteringInfo)

        parentPort.postMessage({ clusteredServices, clusteringInfo })
      }
    } catch (error) {
      console.error('Error in clustering worker:', error)
      parentPort.postMessage({
        error: error.message,
        clusteringInfo: { algorithm },
      })
    }
  },
)

parentPort.on('terminate', async () => {
  console.log('Worker received terminate signal')
  const redis = getRedisClient()
  await redis.quit()
  process.exit(0)
})
