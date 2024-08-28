// src/app/layout.js

'use client'

import { NextUIProvider } from '@nextui-org/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export default function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            cacheTime: 1000 * 60 * 60 * 24, // 24 hours in milliseconds
            staleTime: Infinity,
          },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <NextUIProvider theme={theme}>{children}</NextUIProvider>
    </QueryClientProvider>
  )
}
