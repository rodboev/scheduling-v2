import { getRedisClient } from '@/app/utils/redis'
import { NextResponse } from 'next/server'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'

// Get enforcement state from both Redis and disk
async function getEnforcementState() {
  const redis = getRedisClient()
  const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')

  try {
    // Try Redis first
    const redisState = await redis.hgetall('enforcement')
    if (Object.keys(redisState).length > 0) {
      return redisState
    }

    // Fall back to disk
    const rawEnforcementState = await fsPromises.readFile(filePath, 'utf8')
    const parsedState = JSON.parse(rawEnforcementState)
    if (parsedState?.cacheData) {
      // Store in Redis for next time
      const pipeline = redis.pipeline()
      for (const [id, value] of Object.entries(parsedState.cacheData)) {
        pipeline.hset('enforcement', id, value)
      }
      await pipeline.exec()
      return parsedState.cacheData
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fsPromises.writeFile(filePath, JSON.stringify({ cacheData: {} }))
      return {}
    }
    console.error('Error reading enforcement state:', error)
  }
  return {}
}

export async function GET() {
  try {
    const enforcementState = await getEnforcementState()
    return NextResponse.json(enforcementState)
  } catch (error) {
    console.error('Error getting enforcement state:', error)
    return NextResponse.json(
      { error: 'Failed to get enforcement state' },
      { status: 500 },
    )
  }
}

export async function POST(request) {
  try {
    const { serviceSetupId, enforced } = await request.json()
    const redis = getRedisClient()

    // Update Redis
    await redis.hset('enforcement', serviceSetupId, enforced)

    // Update disk cache
    const filePath = path.join(process.cwd(), 'data', 'enforcementState.json')
    const currentState = await getEnforcementState()
    currentState[serviceSetupId] = enforced
    await fsPromises.writeFile(
      filePath,
      JSON.stringify({ cacheData: currentState }),
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating enforcement state:', error)
    return NextResponse.json(
      { error: 'Failed to update enforcement state' },
      { status: 500 },
    )
  }
}
