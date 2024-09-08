import { useMemo } from 'react'
import { useLocalStorage } from '@/app/hooks/useLocalStorage'

export const useEnforcement = services => {
  const [enforcedServices, setEnforcedServices] = useLocalStorage('enforcedServices', {})

  const updateServiceEnforcement = (id, enforced) => {
    const setupId = id.split('-')[0]
    setEnforcedServices(prev => ({ ...prev, [setupId]: enforced }))
  }

  const updateAllServicesEnforcement = enforced => {
    const newEnforcedServices = {}
    services.forEach(service => {
      const setupId = service.id.split('-')[0]
      newEnforcedServices[setupId] = enforced
    })
    setEnforcedServices(newEnforcedServices)
  }

  const enforcedServicesList = useMemo(() => {
    return services.map(service => {
      const setupId = service.id.split('-')[0]
      return {
        ...service,
        tech: {
          ...service.tech,
          enforced: enforcedServices[setupId] ?? false,
        },
      }
    })
  }, [services, enforcedServices])

  const allServicesEnforced = useMemo(() => {
    return (
      services.length > 0 &&
      services.every(service => {
        const setupId = service.id.split('-')[0]
        return enforcedServices[setupId] ?? false
      })
    )
  }, [services, enforcedServices])

  return {
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    enforcedServicesList,
    allServicesEnforced,
  }
}
