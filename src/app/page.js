// src/app/page.js

'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BigCalendar from '@/app/components/BigCalendar'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours in milliseconds
      staleTime: Infinity,
    },
  },
})

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <BigCalendar />
    </QueryClientProvider>
  )
}
