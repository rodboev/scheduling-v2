'use server'

import { readFromDiskCache, writeToDiskCache } from '@/app/utils/diskCache'
import { getRedisClient } from '@/app/utils/redis'

const CACHE_FILE = 'enforcementState.json'

export async function updateEnforcementState(serviceId, enforced) {
  const redis = getRedisClient()

  // Update Redis
  await redis.hset('enforcement', serviceId, enforced)

  // Backup to disk
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
  const redis = getRedisClient()

  // Try Redis first
  const redisState = await redis.hgetall('enforcement')
  if (Object.keys(redisState).length > 0) {
    return redisState
  }

  // Fall back to disk cache
  const diskState = await readFromDiskCache({ file: CACHE_FILE })
  const enforcementState = diskState?.cacheData || {}

  // Populate Redis for next time
  if (Object.keys(enforcementState).length > 0) {
    const pipeline = redis.pipeline()
    Object.entries(enforcementState).forEach(([id, value]) => {
      pipeline.hset('enforcement', id, value)
    })
    await pipeline.exec()
  }

  return enforcementState
}
