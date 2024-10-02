export function clusterServices(
  services,
  distanceMatrix,
  epsilon = 5000,
  minPoints = 2,
) {
  const points = services.map(service => [
    service.location.latitude,
    service.location.longitude,
  ])

  const clusters = dbscan(
    points,
    epsilon,
    minPoints,
    (a, b) => distanceMatrix[a][b],
  )

  const clusterMap = new Map()
  clusters.forEach((cluster, index) => {
    cluster.forEach(pointIndex => {
      clusterMap.set(pointIndex, index)
    })
  })

  return services.map((service, index) => ({
    ...service,
    cluster: clusterMap.has(index) ? clusterMap.get(index) : -1,
  }))
}

function dbscan(points, eps, minPts, distanceFunction) {
  let clusterId = 0
  const clusters = []
  const visited = new Set()
  const noise = new Set()

  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue
    visited.add(i)

    const neighbors = rangeQuery(i, points, eps, distanceFunction)
    if (neighbors.length < minPts) {
      noise.add(i)
    } else {
      const cluster = expandCluster(
        i,
        neighbors,
        points,
        eps,
        minPts,
        visited,
        distanceFunction,
      )
      clusters.push(cluster)
      clusterId++
    }
  }

  return clusters
}

function rangeQuery(pointIndex, points, eps, distanceFunction) {
  const neighbors = []
  for (let i = 0; i < points.length; i++) {
    if (distanceFunction(pointIndex, i) <= eps) {
      neighbors.push(i)
    }
  }
  return neighbors
}

function expandCluster(
  pointIndex,
  neighbors,
  points,
  eps,
  minPts,
  visited,
  distanceFunction,
) {
  const cluster = [pointIndex]

  for (let i = 0; i < neighbors.length; i++) {
    const neighborIndex = neighbors[i]
    if (!visited.has(neighborIndex)) {
      visited.add(neighborIndex)
      const newNeighbors = rangeQuery(
        neighborIndex,
        points,
        eps,
        distanceFunction,
      )
      if (newNeighbors.length >= minPts) {
        neighbors.push(...newNeighbors.filter(n => !neighbors.includes(n)))
      }
    }
    if (!cluster.includes(neighborIndex)) {
      cluster.push(neighborIndex)
    }
  }

  return cluster
}
