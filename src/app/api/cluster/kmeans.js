const MAX_K_CHANGES = 20000
const MAX_ITERATIONS = 50000

export function kMeans({
  points,
  minPoints,
  maxPoints,
  maxIterations = MAX_ITERATIONS,
}) {
  try {
    const startTime = performance.now()
    let k = Math.max(1, Math.ceil(points.length / maxPoints))
    let bestClusters, bestCentroids, bestK, bestCost
    let lowestCost = Number.POSITIVE_INFINITY
    let kChangeCount = 0
    let totalIterations = 0
    let maxIterationsReached = false
    let currentClusters, currentCentroids, currentCost

    while (kChangeCount < MAX_K_CHANGES && totalIterations < MAX_ITERATIONS) {
      let iterations = 0
      let previousCost = Number.POSITIVE_INFINITY

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
          let minDistance = Number.POSITIVE_INFINITY

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
            currentCost += 
              Math.hypot(
                currentCentroids[i][0] - points[pointIndex][0],
                currentCentroids[i][1] - points[pointIndex][1],
              ) ** 
              2
            
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
        `❌ MAX_ITERATIONS (${MAX_ITERATIONS}) reached, K_CHANGES is ${kChangeCount}, runtime ${runtime}ms`,
      )
      maxIterationsReached = true
    }
    if (kChangeCount >= MAX_K_CHANGES) {
      const runtime = performance.now() - startTime
      console.warn(
        `❌ MAX_K_CHANGES (${MAX_K_CHANGES}) reached, ITERATIONS is ${totalIterations}, runtime ${runtime}ms`,
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
