'use server'

import { readFromDiskCache, writeToDiskCache } from '@/app/utils/diskCache'

const CACHE_FILE = 'enforcementState.json'

export async function updateEnforcementState(serviceId, enforced) {
  const enforcementState = (await readFromDiskCache({ file: CACHE_FILE })) || {}
  enforcementState[serviceId] = enforced
  await writeToDiskCache({ file: CACHE_FILE, data: enforcementState })
  console.log(`Enforcement state updated for service ${serviceId}: ${enforced}`)
  return { success: true }
}

export async function updateAllEnforcementState(services, enforced) {
  const enforcementState = (await readFromDiskCache({ file: CACHE_FILE })) || {}
  services.forEach(service => {
    const serviceId = service.id.split('-')[0]
    enforcementState[serviceId] = enforced
  })
  await writeToDiskCache({ file: CACHE_FILE, data: enforcementState })
  console.log(`Enforcement state updated for all services: ${enforced}`)
  return { success: true }
}

export async function getEnforcementState() {
  const enforcementState = await readFromDiskCache({ file: CACHE_FILE })
  return enforcementState?.cacheData || {}
}
