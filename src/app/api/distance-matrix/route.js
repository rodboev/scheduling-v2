import { getLocations, getFullDistanceMatrix } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const locationIds = searchParams.get('ids')?.split(',').filter(Boolean) || []

  if (!locationIds.length) {
    return NextResponse.json({ error: 'No location IDs provided' }, { status: 400 })
  }

  try {
    // Get or update the full distance matrix in array format
    const matrix = await getFullDistanceMatrix(locationIds, {
      force: true,
      format: 'array', // Always use array format
    })

    return NextResponse.json(matrix)
  } catch (error) {
    console.error('Error getting distance matrix:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
