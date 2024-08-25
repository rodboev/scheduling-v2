// src/app/page.js

'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BigCalendar from '@/app/components/BigCalendar'

const queryClient = new QueryClient()

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <BigCalendar />
    </QueryClientProvider>
  )
}
