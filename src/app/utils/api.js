// /src/app/utils/api.js

import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export const fetchServiceSetups = async () => {
  try {
    const { data } = await api.get('/services')
    return data
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error
  }
}
