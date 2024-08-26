// src/app/hooks/useServiceSetups.js

import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useState, useCallback, useEffect } from 'react'

const fetchServiceSetups = async (ids) => {
  const { data } = await axios.get(`/api/services?ids=${ids.join(',')}`)
  return data
}

export function useServiceSetups() {
  const queryClient = useQueryClient()
  const [localEnforced, setLocalEnforced] = useState({})

  const techData = [
    { ids: [20286, 16805, 16807, 20838, 12707, 117691] },
    { ids: [21829] },
    { ids: [17632, 19741, 20315, 18719, 20700, 15725, 15305] },
    {
      ids: [21473, 11760, 12059, 19635, 20552, 21419, 3349, 3597, 3369, 14397, 12150, 12149, 21029],
    },
  ]

  const allIds = techData.flatMap(({ ids }) => ids)

  const query = useQuery({
    queryKey: ['serviceSetups', allIds],
    queryFn: () => fetchServiceSetups(allIds),
    select: useCallback(
      (data) => {
        console.log('Raw service setups:', data)
        return techData.flatMap(({ tech, ids }) =>
          ids
            .map((id) => {
              const setup = data.find((s) => s.id === id)
              return setup
                ? {
                    ...setup,
                    tech: {
                      ...setup.tech,
                      name: tech,
                      enforced: localEnforced[id] ?? setup.tech.enforced,
                    },
                  }
                : null
            })
            .filter(Boolean),
        )
      },
      [localEnforced],
    ),
  })

  const updateEnforced = useCallback(
    (id, enforced) => {
      const setupId = id.split('-')[0] // Extract the setup ID from the event ID
      setLocalEnforced((prev) => {
        const newState = { ...prev, [setupId]: enforced }
        console.log('New localEnforced state:', newState)
        return newState
      })
      queryClient.invalidateQueries(['serviceSetups', allIds])
    },
    [queryClient, allIds],
  )

  const updateAllEnforced = useCallback(
    (enforced) => {
      const newLocalEnforced = allIds.reduce((acc, id) => {
        acc[id] = enforced
        return acc
      }, {})
      setLocalEnforced(newLocalEnforced)
      queryClient.invalidateQueries(['serviceSetups', allIds])
    },
    [queryClient, allIds],
  )

  useEffect(() => {
    console.log('localEnforced state:', localEnforced)
  }, [localEnforced])

  return {
    ...query,
    updateEnforced,
    updateAllEnforced,
  }
}
