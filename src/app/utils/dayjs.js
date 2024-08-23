import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

export function convertToETTime(timeString) {
  if (!timeString) return null

  // Parse the time without timezone information
  const time = dayjs(timeString).utc()

  // Extract hours and minutes
  const hours = time.hour()
  const minutes = time.minute()

  // Create a new dayjs object with today's date and the extracted time
  const today = dayjs().tz('America/New_York').startOf('day')
  const etDate = today.hour(hours).minute(minutes)

  return etDate.format('h:mm A')
}
