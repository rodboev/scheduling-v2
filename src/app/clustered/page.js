'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ClusteredCalendar from '@/app/components/ClusteredCalendar'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours
      staleTime: Infinity,
    },
  },
})

export default function ClusteredPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ClusteredCalendar />
    </QueryClientProvider>
  )
} 