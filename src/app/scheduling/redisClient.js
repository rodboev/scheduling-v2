import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

export async function getDistances(pairs) {
  const pipeline = redis.pipeline()

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => (err ? null : parseFloat(result)))
}

export async function getLocationInfo(ids) {
  const pipeline = redis.pipeline()

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
            longitude: parseFloat(pos[0]),
            latitude: parseFloat(pos[1]),
          },
        }
      : null
  })
}

export async function closeRedisConnection() {
  await redis.quit()
}
