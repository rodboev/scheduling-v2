// src/app/hooks/useServiceSetups.js

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getServiceSetups } from '@/app/actions/getServiceSetups'

export const useServiceSetups = () => {
  const queryClient = useQueryClient()
  const [localEnforced, setLocalEnforced] = useState({})

  const {
    data: serviceSetups,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['serviceSetups'],
    queryFn: () => getServiceSetups(),
    select: (data) => {
      console.log('Filtered service setups:', data.length)
      return data.map((setup) => ({
        ...setup,
        tech: {
          ...setup.tech,
          enforced: localEnforced[setup.id] ?? setup.tech.enforced,
        },
      }))
    },
  })

  function updateEnforced(id, enforced) {
    const setupId = id.includes('-') ? id.split('-')[0] : id
    setLocalEnforced((prev) => {
      const newLocalEnforced = { ...prev, [setupId]: enforced }
      console.log('New localEnforced state:', newLocalEnforced)
      return newLocalEnforced
    })
    // Return the updated setupId and enforced value
    return { setupId, enforced }
  }

  function updateAllEnforced(enforced) {
    if (serviceSetups) {
      const newLocalEnforced = serviceSetups.reduce((acc, setup) => {
        acc[setup.id] = enforced
        return acc
      }, {})
      setLocalEnforced(newLocalEnforced)
      queryClient.invalidateQueries({ queryKey: ['serviceSetups'] })
    }
  }

  return {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
  }
}
