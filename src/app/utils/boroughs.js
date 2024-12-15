import * as turf from '@turf/turf'

// GeoJSON for NYC boroughs (simplified for performance)
const BOROUGH_BOUNDARIES = {
  manhattan: {
    type: 'Feature',
    properties: { borough: 'Manhattan' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-74.0479, 40.6829],
          [-74.0179, 40.7029],
          [-73.9723, 40.759],
          [-73.9261, 40.796],
          [-73.9298, 40.8784],
          [-73.9298, 40.8784],
          [-73.9419, 40.8803],
          [-74.0096, 40.7769],
          [-74.0479, 40.6829],
        ],
      ],
    },
  },
  brooklyn: {
    type: 'Feature',
    properties: { borough: 'Brooklyn' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-74.0421, 40.5701],
          [-73.833, 40.5813],
          [-73.833, 40.7041],
          [-73.9564, 40.7041],
          [-74.0421, 40.5701],
        ],
      ],
    },
  },
  queens: {
    type: 'Feature',
    properties: { borough: 'Queens' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-73.7793, 40.5913],
          [-73.7793, 40.7831],
          [-73.918, 40.7831],
          [-73.918, 40.5913],
          [-73.7793, 40.5913],
        ],
      ],
    },
  },
  bronx: {
    type: 'Feature',
    properties: { borough: 'Bronx' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-73.9297, 40.7851],
          [-73.7793, 40.7851],
          [-73.7793, 40.9176],
          [-73.9297, 40.9176],
          [-73.9297, 40.7851],
        ],
      ],
    },
  },
}

export function getBorough(lat, lng) {
  const point = turf.point([lng, lat])

  for (const [boroughName, boundary] of Object.entries(BOROUGH_BOUNDARIES)) {
    if (turf.booleanPointInPolygon(point, boundary)) {
      return boroughName
    }
  }
  return null
}

export function areSameBorough(lat1, lng1, lat2, lng2) {
  const borough1 = getBorough(lat1, lng1)
  const borough2 = getBorough(lat2, lng2)
  return borough1 && borough1 === borough2
}
