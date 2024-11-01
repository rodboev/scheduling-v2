// src/app/page.js

'use client'

import BigCalendar from '@/app/components/BigCalendar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// src/app/page.js

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours in milliseconds
      staleTime: Number.POSITIVE_INFINITY,
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
