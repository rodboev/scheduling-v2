export function DBSCAN({
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
