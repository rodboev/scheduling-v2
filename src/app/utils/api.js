// /src/app/utils/api.js

import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export const techData = [
  { tech: 'ALJADI', ids: [20286, 16805, 16807, 20838, 12707, 117691] },
  { tech: 'BAEK MALIK', ids: [21829] },
  { tech: 'BLACK R.', ids: [17632, 19741, 20315, 18719, 20700, 15725, 15305] },
  {
    tech: 'BORDEAU S',
    ids: [21473, 11760, 12059, 19635, 20552, 21419, 3349, 3597, 3369, 14397, 12150, 12149, 21029],
  },
]

export const fetchServiceSetups = async () => {
  try {
    const allIds = techData.flatMap((tech) => tech.ids)
    const { data } = await api.get(`/services?ids=${allIds.join(',')}`)
    return data
  } catch (error) {
    console.error('Error fetching service setups:', error)
    throw error
  }
}
