import { calculateDistance } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const locationIds = searchParams.get('ids')?.split(',') || []

  if (!locationIds.length) {
    return NextResponse.json({ error: 'No location IDs provided' }, { status: 400 })
  }

  try {
    // Create distance matrix for all location pairs
    const matrix = {}
    for (const id1 of locationIds) {
      for (const id2 of locationIds) {
        if (id1 === id2) continue
        const key = `${id1},${id2}`
        if (!matrix[key]) {
          const result = await calculateDistance(id1, id2)
          if (result?.pair) {
            matrix[key] = result.pair.distance
          }
        }
      }
    }

    return NextResponse.json(matrix)
  } catch (error) {
    console.error('Error getting distance matrix:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
