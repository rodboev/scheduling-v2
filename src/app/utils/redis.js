import Redis from 'ioredis'
import NodeCache from 'node-cache'

let redis = null
export const memoryCache = new NodeCache({ stdTTL: 3600 })

export function getRedisClient() {
  if (!redis) {
    const redisUrl = process.env.REDISCLOUD_URL || 'redis://localhost:6379'
    if (!redisUrl) {
      throw new Error('Error: REDISCLOUD_URL environment variable is not set')
    }

    console.log(`Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, '//')}`)

    const options = {
      retryStrategy: times => {
        if (times > 1) {
          console.error(`Redis connection failed after ${times} attempts`)
          return null
        }
        return Math.min(times * 100, 3000)
      },
      connectTimeout: 10000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      tls: redisUrl.includes('redislabs.com')
        ? { rejectUnauthorized: false }
        : undefined,
    }

    redis = new Redis(redisUrl, options)

    redis.on('error', error => {
      console.error('Redis connection error:', error)
    })

    redis.on('connect', () => {
      console.log('Successfully connected to Redis')
    })
  }
  return redis
}

export async function closeRedisConnection() {
  if (redis) {
    await redis.quit()
    redis = null
    console.log('Redis connection closed')
  }
}
