import { deleteCachedData } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    console.log('Starting cache refresh')

    // Clear all distance-related caches
    deleteCachedData('distance:*')
    deleteCachedData('distanceMatrix:*')
    deleteCachedData('clusters:*') // Also clear cluster caches

    // Add a small delay to ensure cache clearing has propagated
    await new Promise(resolve => setTimeout(resolve, 100))

    console.log('Cache refresh completed')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error refreshing distances:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
