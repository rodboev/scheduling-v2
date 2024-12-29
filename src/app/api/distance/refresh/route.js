import { deleteCachedData } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Clear all distance-related caches
    deleteCachedData('distance:*')
    deleteCachedData('distanceMatrix:*')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error refreshing distances:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
