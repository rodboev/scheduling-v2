// src/app/hooks/useServiceSetups.js

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { fetchServiceSetups } from '@/app/utils/api'

export function useServiceSetups() {
  const queryClient = useQueryClient()
  const [localEnforced, setLocalEnforced] = useState({})

  const query = useQuery({
    queryKey: ['serviceSetups'],
    queryFn: fetchServiceSetups,
    select: useCallback(
      (data) => {
        return data.map((setup) => ({
          ...setup,
          tech: {
            ...setup.tech,
            enforced: localEnforced[setup.id] ?? setup.tech.enforced,
          },
        }))
      },
      [localEnforced],
    ),
  })

  const updateEnforced = useCallback(
    (id, enforced) => {
      const setupId = id.includes('-') ? id.split('-')[0] : id
      setLocalEnforced((prev) => ({
        ...prev,
        [setupId]: enforced,
      }))
      queryClient.invalidateQueries(['serviceSetups'])
    },
    [queryClient],
  )

  const updateAllEnforced = useCallback(
    (enforced) => {
      if (query.data) {
        const newLocalEnforced = query.data.reduce((acc, setup) => {
          acc[setup.id] = enforced
          return acc
        }, {})
        setLocalEnforced(newLocalEnforced)
        queryClient.invalidateQueries(['serviceSetups'])
      }
    },
    [query.data, queryClient],
  )

  return {
    ...query,
    updateEnforced,
    updateAllEnforced,
  }
}
