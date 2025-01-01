'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BigCalendar from '@/app/calendar/BigCalendar'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours
      staleTime: Infinity,
    },
  },
})

export default function CalendarPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <BigCalendar />
    </QueryClientProvider>
  )
}
