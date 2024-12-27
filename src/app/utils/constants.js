// Clustering constants
export const MAX_RADIUS_MILES = 4 // Soft cap - services beyond this distance get penalized
export const HARD_MAX_RADIUS_MILES = 6 // Hard cap - services beyond this distance cannot be connected
export const ENFORCE_BOROUGH_BOUNDARIES = false
export const TECH_SPEED_MPH = 5 // Average technician travel speed in miles per hour (point to point distance)

// Time constants
export const MINUTES_PER_HOUR = 60
export const HOURS_PER_SHIFT = 8
export const SHIFT_DURATION = HOURS_PER_SHIFT * MINUTES_PER_HOUR
export const SHIFT_DURATION_MS = HOURS_PER_SHIFT * 60 * 60 * 1000 // 8 hours in milliseconds

// Shift times in UTC
export const SHIFTS = {
  1: {
    start: '12:00', // 8am EDT
    end: '20:00', // 4pm EDT
  },
  2: {
    start: '20:00', // 4pm EDT
    end: '04:00', // 12am EDT
  },
  3: {
    start: '04:00', // 12am EDT (next day)
    end: '12:00', // 8am EDT (next day)
  },
}
