import axios from 'axios'
import { TECH_SPEED_MPH } from '@/app/utils/constants'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || ''

export async function getDistance(fromService, toService) {
  if (!fromService?.location?.id || !toService?.location?.id) {
    console.warn('Missing location IDs for distance calculation')
    return null
  }

  try {
    const response = await axios.get(`${BASE_URL}/api/distance`, {
      params: {
        fromId: fromService.location.id.toString(),
        toId: toService.location.id.toString(),
      },
    })

    return response.data?.distance ?? null
  } catch (error) {
    console.error('Failed to get distance from API:', error)
    return null
  }
}

export function calculateTravelTime(distance) {
  if (!distance) return null
  return Math.ceil((distance / TECH_SPEED_MPH) * 60) // Returns travel time in minutes
}
