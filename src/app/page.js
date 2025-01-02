// src/app/page.js

'use client'

import Link from 'next/link'
import { Button } from '@/app/components/ui/button'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      cacheTime: 1000 * 60 * 60 * 24, // 24 hours
      staleTime: Infinity,
    },
  },
})

export default function Home() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen flex-col">
        <div className="flex h-full flex-col items-center justify-center">
          <h1 className="mb-12 text-2xl font-bold">Routing / Scheduling</h1>

          <div className="flex flex-col gap-6">
            <Link href="/map" target="_blank">
              <Button size="lg" variant="outline" className="w-64">
                Map View
              </Button>
            </Link>

            <Link href="/calendar">
              <Button size="lg" variant="outline" className="w-64">
                Calendar View
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </QueryClientProvider>
  )
}
