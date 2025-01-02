import { deleteCachedData, getLocations } from '@/app/utils/locationCache'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    console.log('Starting cache refresh')

    // Clear all distance-related caches
    deleteCachedData('distance:*')
    deleteCachedData('distanceMatrix:*')
    deleteCachedData('clusters:*') // Also clear cluster caches

    // Force refresh of location data
    const locationCount = await getLocations(true) // Pass true to force refresh
    console.log(`Refreshed ${locationCount} locations`)

    console.log('Cache refresh completed')
    return NextResponse.json({
      success: true,
      locationCount,
      message: 'Cache cleared and locations refreshed',
    })
  } catch (error) {
    console.error('Error refreshing distances:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
