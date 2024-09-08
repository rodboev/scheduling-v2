// src/app/hooks/useServiceSetups.js
import { useLocalStorage } from '@/app/hooks/useLocalStorage'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

export const useServiceSetups = () => {
  const queryClient = useQueryClient()
  const [enforcedServices, setEnforcedServices] = useLocalStorage('enforcedServices', {})

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
          enforced: enforcedServices[setup.id] ?? setup.tech.enforced,
        },
      }))
    },
  })

  function updateEnforcedServices(id, enforced) {
    const setupId = id.includes('-') ? id.split('-')[0] : id
    setEnforcedServices(prev => {
      const newEnforcedServices = { ...prev, [setupId]: enforced }
      console.log('New enforcedServices state:', newEnforcedServices)
      return newEnforcedServices
    })
  }

  function updateAllEnforcedServices(enforced) {
    if (serviceSetups) {
      const newEnforcedServices = serviceSetups.reduce((acc, setup) => {
        acc[setup.id] = enforced
        return acc
      }, {})
      setEnforcedServices(newEnforcedServices)
      queryClient.invalidateQueries({ queryKey: ['serviceSetups'] })
    }
  }

  return {
    data: serviceSetups,
    isLoading,
    error,
    updateEnforcedServices,
    updateAllEnforcedServices,
    enforcedServices,
  }
}
