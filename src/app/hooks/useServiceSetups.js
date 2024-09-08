// src/app/hooks/useServiceSetups.js
import { useLocalStorage } from '@/app/hooks/useLocalStorage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const useServiceSetups = () => {
  const queryClient = useQueryClient()
  const [enforcedServiceSetups, setEnforcedServiceSetups] = useLocalStorage(
    'enforcedServiceSetups',
    {},
  )

  const {
    data: serviceSetups,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['serviceSetups'],
    queryFn: () => axios.get('api/serviceSetups').then(res => res.data),
    select: data => {
      console.log('Filtered service setups:', data.length)
      return data.map(setup => ({
        ...setup,
        tech: {
          ...setup.tech,
          enforced: enforcedServiceSetups[setup.id] ?? setup.tech.enforced,
        },
      }))
    },
  })

  function updateEnforced(id, enforced) {
    const setupId = id.includes('-') ? id.split('-')[0] : id
    setEnforcedServiceSetups(prev => {
      const newEnforcedServiceSetups = { ...prev, [setupId]: enforced }
      console.log('New enforcedServiceSetups state:', newEnforcedServiceSetups)
      return newEnforcedServiceSetups
    })
  }

  function updateAllEnforced(enforced) {
    if (serviceSetups) {
      const newEnforcedServiceSetups = serviceSetups.reduce((acc, setup) => {
        acc[setup.id] = enforced
        return acc
      }, {})
      setEnforcedServiceSetups(newEnforcedServiceSetups)
      queryClient.invalidateQueries({ queryKey: ['serviceSetups'] })
    }
  }

  return {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
    enforcedServiceSetups,
  }
}
