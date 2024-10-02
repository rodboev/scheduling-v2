import {
  getRedisClient,
  ensureDistanceData,
  closeRedisConnection,
} from '../utils/redisUtil.js'

const redis = getRedisClient()

export async function getDistances(pairs) {
  await ensureDistanceData()

  const pipeline = redis.pipeline()

  for (const [id1, id2] of pairs) {
    pipeline.geodist('locations', id1, id2, 'mi')
  }

  const results = await pipeline.exec()
  return results.map(([err, result]) => (err ? null : parseFloat(result)))
}

export async function getLocationInfo(ids) {
  await ensureDistanceData()

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

export { closeRedisConnection }
