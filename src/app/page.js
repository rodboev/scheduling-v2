// src/app/page.js

'use client'

import { Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TechCalendar from '@/app/components/TechCalendar'

const queryClient = new QueryClient()

export default function CalendarPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <main>
        <h1>Tech Calendar</h1>
        <Suspense fallback={<div>Loading calendar...</div>}>
          <TechCalendar />
        </Suspense>
      </main>
    </QueryClientProvider>
  )
}
