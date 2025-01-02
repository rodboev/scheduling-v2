import { getFullDistanceMatrix } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const locationIds = searchParams.get('ids')?.split(',') || []

  if (!locationIds.length) {
    return NextResponse.json({ error: 'No location IDs provided' }, { status: 400 })
  }

  try {
    // Get or update the full distance matrix
    const matrix = await getFullDistanceMatrix(locationIds)

    // Return only the requested pairs
    const requestedMatrix = {}
    for (let i = 0; i < locationIds.length; i++) {
      for (let j = 0; j < locationIds.length; j++) {
        if (i === j) continue
        const key = `${locationIds[i]},${locationIds[j]}`
        if (matrix[key] !== undefined) {
          requestedMatrix[key] = matrix[key]
        }
      }
    }

    return NextResponse.json(requestedMatrix)
  } catch (error) {
    console.error('Error getting distance matrix:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
