import { getLocationPairs } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const pairs = searchParams.get('pairs')?.split(';') || []

  if (!pairs.length) {
    return NextResponse.json({ error: 'No location pairs provided' }, { status: 400 })
  }

  try {
    const result = await getLocationPairs(pairs)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error getting distances:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
