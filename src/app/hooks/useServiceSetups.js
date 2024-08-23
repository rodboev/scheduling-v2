// src/app/hooks/useServiceSetups.js

import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

const fetchServiceSetups = async (ids) => {
  const { data } = await axios.get(`http://localhost:3000/api/services?ids=${ids.join(',')}`)
  return data
}

export function useServiceSetups() {
  const techData = [
    { tech: 'ALJADI', ids: [20286, 16805, 16807, 20838, 12707] },
    { tech: 'BAEK MALIK', ids: [21829] },
    { tech: 'BLACK R.', ids: [17632, 19741, 20700, 20315, 18719, 15725, 15305] },
  ]

  return useQuery({
    queryKey: ['serviceSetups'],
    queryFn: async () => {
      const allIds = techData.flatMap(({ ids }) => ids)
      const setups = await fetchServiceSetups(allIds)

      const result = techData.flatMap(({ tech, ids }) =>
        ids
          .map((id) => {
            const setup = setups.find((s) => s.id === id)
            return setup ? { ...setup, tech: { ...setup.tech, name: tech } } : null
          })
          .filter(Boolean),
      )

      // Log the fetched objects
      console.log('Fetched service setups:', JSON.stringify(result, null, 2))

      return result
    },
  })
}
