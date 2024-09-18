export function formatDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function formatTime(date) {
  return date
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .toLowerCase()
}

export function calculateDuration(start, end) {
  return (end - start) / (1000 * 60 * 60)
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

export function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000)
}

export function max(...dates) {
  return new Date(Math.max(...dates.map(d => d.getTime())))
}

export function min(...dates) {
  return new Date(Math.min(...dates.map(d => d.getTime())))
}
