// src/app/scheduling/worker.js

// Clustering Services by Location using precomputed distances

/**
 * Clusters services based on their geographical locations using precomputed distances.
 * @param {Array} services - Array of services to be clustered.
 * @returns {Array} - Array of clusters, each containing services.
 */
async function clusterServices(services) {
  const dbscan = new Clusterer.DBSCAN()

  // Step 1: Precompute the distance matrix
  const shift = { services } // Dummy shift object to use calculateDistancesForShift
  const distanceMatrix = await calculateDistancesForShift(shift)

  // Step 2: Prepare the dataset for DBSCAN (each service is a point)
  const dataset = services.map((service, index) => index) // Using index as point

  // Step 3: Define a custom distance function
  const epsilon = 10 // Adjusted based on data
  const minPoints = 1 // Minimum number of points to form a cluster

  const distanceFunction = (a, b) => {
    // a and b are indices of services
    const distance = distanceMatrix[a][b]
    return distance !== null ? distance : Infinity
  }

  // Step 4: Run DBSCAN with the custom distance function
  const clusters = dbscan.run(dataset, epsilon, minPoints, distanceFunction)

  // Step 5: Handle noise (outliers) by treating them as separate clusters
  const noise = dbscan.noise.map(index => services[index])

  // Step 6: Convert clusters of indices to clusters of service objects
  const clusteredServices = clusters.map(cluster =>
    cluster.map(index => services[index]),
  )

  // Step 7: Append noise as separate clusters
  if (noise.length > 0) {
    clusteredServices.push(noise)
  }

  return clusteredServices
}

/**
 * Calculates the Haversine distance between two geographical points.
 * @param {Array} a - [latitude, longitude] of point A.
 * @param {Array} b - [latitude, longitude] of point B.
 * @returns {number} - Distance in miles.
 */
function calculateHaversineDistance(a, b) {
  const toRadians = deg => (deg * Math.PI) / 180
  const R = 3958.8 // Radius of the Earth in miles
  const lat1 = a[0]
  const lon1 = a[1]
  const lat2 = b[0]
  const lon2 = b[1]

  const dLat = toRadians(lat2 - lat1)
  const dLon = toRadians(lon2 - lon1)

  const radLat1 = toRadians(lat1)
  const radLat2 = toRadians(lat2)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)

  const aCalc =
    sinDLat * sinDLat +
    Math.cos(radLat1) * Math.cos(radLat2) * sinDLon * sinDLon
  const c = 2 * Math.atan2(Math.sqrt(aCalc), Math.sqrt(1 - aCalc))

  const distance = R * c
  return distance
}
