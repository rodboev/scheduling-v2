import { dayjsInstance as dayjs } from './dayjs'

export function getDefaultDateRange() {
  // Set to week of Sep 1-7, 2024
  // Use NY timezone
  const startDate = dayjs.tz('2024-09-01', 'America/New_York').startOf('day')
  const endDate = dayjs.tz('2024-09-07', 'America/New_York').endOf('day')

  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  }
}
