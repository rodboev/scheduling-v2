import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

const fetchServiceSetups = async (ids) => {
  const { data } = await axios.get(`http://localhost:3000/api/services?ids=${ids.join(',')}`)
  return data
}

export function useServiceSetups() {
  const techData = [
    { tech: 'ALJADI', ids: [20286, 16805, 16807, 20838, 12707, 117691] },
    { tech: 'BAEK MALIK', ids: [21829] },
    { tech: 'BLACK R.', ids: [17632, 19741, 20315, 18719, 20700, 15725, 15305] },
    {
      tech: 'BORDEAU S',
      ids: [21473, 11760, 12059, 19635, 20552, 21419, 3349, 3597, 3369, 14397, 12150, 12149, 21029],
    },
  ]

  const allIds = techData.flatMap(({ ids }) => ids)

  return useQuery({
    queryKey: ['serviceSetups', allIds],
    queryFn: () => fetchServiceSetups(allIds),
    select: (data) => {
      console.log('Raw service setups:', data)
      return techData.flatMap(({ tech, ids }) =>
        ids
          .map((id) => {
            const setup = data.find((s) => s.id === id)
            return setup ? { ...setup, tech: { ...setup.tech, name: tech } } : null
          })
          .filter(Boolean),
      )
    },
  })
}
