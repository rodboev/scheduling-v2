import axios from 'axios'

export async function getLocationInfo(ids) {
  const response = await axios.get('/api/locations', {
    params: { ids: ids.join(',') },
  })
  return response.data
}

export async function storeLocations(serviceSetups) {
  const response = await axios.post('/api/locations', serviceSetups)
  return response.data
}

export async function getDistances(pairs) {
  const response = await axios.get('/api/distance', {
    params: { pairs: JSON.stringify(pairs) },
  })
  return response.data
}
