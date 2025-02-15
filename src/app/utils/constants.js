// Clustering constants
export const NUM_TECHS = -1 // Maximum number of techs to consider
export const MAX_RADIUS_MILES_ACROSS_BOROUGHS = 3 // Soft cap - services beyond this distance get penalized
export const HARD_MAX_RADIUS_MILES = 6 // Hard cap - services beyond this distance cannot be connected
export const ENFORCE_BOROUGH_BOUNDARIES = true
export const TECH_SPEED_MPH = 10 // Average technician travel speed in miles per hour
export const MERGE_CLOSEST_SHIFTS = 10 // Number of closest shifts to consider for merging
export const MAX_TIME_SEARCH = 2 * 60 // 2 hours in minutes
export const MAX_MERGE_ATTEMPTS = 6 // Limit merge attempts per shift
export const TECH_START_TIME_VARIANCE = 20 * 60 * 1000 // 20 minutes in milliseconds

// Scheduling constraints
export const MIN_BUFFER_BETWEEN_SERVICES = 15 * 60 * 1000 // 15 minute minimum buffer between services
export const LONG_SERVICE_THRESHOLD = 240 // 4 hours in minutes - services longer than this get special handling

// Time constants
export const MINUTES_PER_HOUR = 60
export const HOURS_PER_SHIFT = 8
export const SHIFT_DURATION = HOURS_PER_SHIFT * MINUTES_PER_HOUR
export const SHIFT_DURATION_MS = HOURS_PER_SHIFT * 60 * 60 * 1000 // 8 hours in milliseconds

// Default date for calendar and map views
export const DEFAULT_DATE = '2025-01-06' // Default date in YYYY-MM-DD format

export const SHOW_ONLY_BOROS = false

// Borough codes from GeoJSON
export const BOROUGH_CODES = {
  MANHATTAN: '1',
  BRONX: '2',
  BROOKLYN: '3',
  QUEENS: '4',
  STATEN_ISLAND: '5'
}
