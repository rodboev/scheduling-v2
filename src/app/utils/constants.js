// Clustering constants
export const MAX_RADIUS_MILES_ACROSS_BOROUGHS = 3 // Soft cap - services beyond this distance get penalized
export const HARD_MAX_RADIUS_MILES = 5 // Hard cap - services beyond this distance cannot be connected
export const ENFORCE_BOROUGH_BOUNDARIES = true
export const TECH_SPEED_MPH = 10 // Average technician travel speed in miles per hour

// Time constants
export const MINUTES_PER_HOUR = 60
export const HOURS_PER_SHIFT = 8
export const SHIFT_DURATION = HOURS_PER_SHIFT * MINUTES_PER_HOUR
export const SHIFT_DURATION_MS = HOURS_PER_SHIFT * 60 * 60 * 1000 // 8 hours in milliseconds
