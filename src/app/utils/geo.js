import nycGeoJson from './nyc.geojson'

/**
 * Checks if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point, polygon) {
  const [lng, lat] = point
  let inside = false

  // Loop through vertices
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]

    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
    
    if (intersect) inside = !inside
  }

  return inside
}

/**
 * Checks if a point is within any NYC borough
 */
export function isPointInNYC(lat, lng) {
  // Handle invalid inputs
  if (!lat || !lng || lat === 0 || lng === 0 || !nycGeoJson?.features) {
    console.warn('Invalid coordinates or GeoJSON data:', { lat, lng })
    return false
  }

  // Iterate through each feature (borough/neighborhood) in the GeoJSON
  for (const feature of nycGeoJson.features) {
    const geometry = feature?.geometry
    if (!geometry?.type || !geometry?.coordinates) continue

    if (geometry.type === 'Polygon') {
      // Check single polygon
      if (isPointInPolygon([lng, lat], geometry.coordinates[0])) {
        return true
      }
    } else if (geometry.type === 'MultiPolygon') {
      // Check each polygon in the MultiPolygon
      for (const polygon of geometry.coordinates) {
        if (isPointInPolygon([lng, lat], polygon[0])) {
          return true
        }
      }
    }
  }

  return false
} 