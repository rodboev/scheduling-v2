import Redis from 'ioredis'

let redis

export function getRedisClient() {
  if (!redis) {
    const redisUrl = process.env.REDISCLOUD_URL || 'redis://localhost:6379'
    if (!redisUrl) {
      throw new Error('Error: REDISCLOUD_URL environment variable is not set')
    }

    console.log(`Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, '//')}`) // Hide credentials in logs

    const options = {
      retryStrategy: (times) => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`)
          return null // Stop retrying after 3 attempts
        }
        return Math.min(times * 100, 3000) // Increase delay between retries
      },
      connectTimeout: 10000, // 10 seconds
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

export async function getDistances(pairs) {
  const client = getRedisClient()
  const pipeline = client.pipeline()

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => (err ? null : Number.parseFloat(result)))
}

export async function getLocationInfo(ids) {
  const client = getRedisClient()
  const pipeline = client.pipeline()

  for (const id of ids) {
    pipeline.geopos('locations', id)
    pipeline.hget('company_names', id)
  }

  const results = await pipeline.exec()
  return ids.map((id, index) => {
    const [, pos] = results[index * 2]
    const [, company] = results[index * 2 + 1]
    return pos
      ? {
          id,
          company,
          location: {
            longitude: Number.parseFloat(pos[0]),
            latitude: Number.parseFloat(pos[1]),
          },
        }
      : null
  })
}

export async function closeRedisConnection() {
  if (redis) {
    await redis.quit()
    redis = null
    console.log('Redis connection closed')
  }
}