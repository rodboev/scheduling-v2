import { TECH_SPEED_MPH } from '../../utils/constants.js'

export function calculateTravelTime(distance) {
  if (!distance) return 15 // Default to 15 minutes if no distance available

  // Calculate travel time in minutes based on distance and speed
  return Math.ceil((distance / TECH_SPEED_MPH) * 60)
}
