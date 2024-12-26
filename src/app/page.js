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
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h1 className="text-2xl font-bold">Service Scheduling Tools</h1>
        </div>
        
        <div className="flex flex-col items-center justify-center gap-6 p-12">
          <Link href="/calendar">
            <Button size="lg" variant="outline" className="w-64">
              Standard Calendar View
            </Button>
          </Link>
          
          <Link href="/clustered">
            <Button size="lg" variant="outline" className="w-64">
              Clustered Calendar View
            </Button>
          </Link>
          
          <Link href="/map" target="_blank">
            <Button size="lg" variant="outline" className="w-64">
              Map View
            </Button>
          </Link>
        </div>
      </div>
    </QueryClientProvider>
  )
}
