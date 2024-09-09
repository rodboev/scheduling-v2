import { useMemo } from 'react'
import { updateEnforcementState, updateAllEnforcementState } from '@/app/actions/enforcementActions'

export const useEnforcement = (services, refetchSchedule) => {
  const updateServiceEnforcement = async (id, enforced) => {
    const result = await updateEnforcementState(id.split('-')[0], enforced)
    if (result.success) {
      refetchSchedule()
    }
  }

  const updateAllServicesEnforcement = async enforced => {
    const result = await updateAllEnforcementState(services, enforced)
    if (result.success) {
      refetchSchedule()
    }
  }

  const enforcedServicesList = useMemo(() => services, [services])

  const allServicesEnforced = useMemo(() => {
    return services.length > 0 && services.every(service => service.tech.enforced)
  }, [services])

  return {
    updateServiceEnforcement,
    updateAllServicesEnforcement,
    enforcedServicesList,
    allServicesEnforced,
  }
}
