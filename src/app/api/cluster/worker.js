import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { DBSCAN } from './dbscan.js'
import { kMeans } from './kmeans.js'
import { scheduleServices } from './scheduling.js'

// Constants (moved from constants.js)
const MAX_RADIUS_MILES = 5

// Moved from outliers.js
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

parentPort.on(
  'message',
  async ({
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
        noisePoints: clusterCounts['-1'] || 0,
        outliersCount: clusterCounts['-2'] || 0,
        clusterDistribution: Object.entries(clusterCounts).map(
          ([cluster, count]) => ({ [cluster]: count }),
        ),
      }

      // After clustering, schedule services within each cluster
      const scheduledServices = await scheduleServices(
        clusteredServices,
        distanceMatrix,
      )

      // Update clusteredServices with scheduled times
      clusteredServices = scheduledServices.map(service => {
        if (service.cluster >= 0) {
          return {
            ...service,
            start: service.start || service.time.preferred,
            end:
              service.end ||
              new Date(
                new Date(service.start || service.time.preferred).getTime() +
                  service.time.duration * 60000,
              ).toISOString(),
          }
        }
        return service
      })

      const endTime = performance.now()
      const duration = endTime - startTime

      clusteringInfo = {
        ...clusteringInfo,
        performanceDuration: Number.parseInt(duration),
      }

      parentPort.postMessage({
        clusteredServices,
        clusteringInfo,
      })
    } catch (error) {
      console.error('Error in clustering worker:', error)
      parentPort.postMessage({
        error: error.message,
        clusteringInfo: {
          algorithm,
        },
      })
    }
  },
)

parentPort.on('terminate', () => {
  console.log('Worker received terminate signal')
  process.exit(0)
})
