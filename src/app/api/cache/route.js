import { memoryCache } from '@/app/utils/redis'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) {
    return NextResponse.json({ error: 'No key provided' }, { status: 400 })
  }

  const data = memoryCache.get(key)
  return NextResponse.json({ data })
}

export async function POST(request) {
  const { key, data, ttl } = await request.json()

  if (!key || data === undefined) {
    return NextResponse.json(
      { error: 'Key and data are required' },
      { status: 400 },
    )
  }

  let actualTTL = ttl || 300
  if (key.startsWith('location:')) {
    actualTTL = 86400
  } else if (key.startsWith('distanceMatrix:')) {
    actualTTL = 3600
  }

  memoryCache.set(key, data, actualTTL)
  return NextResponse.json({ success: true })
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) {
    return NextResponse.json({ error: 'No key provided' }, { status: 400 })
  }

  memoryCache.del(key)
  return NextResponse.json({ success: true })
}
