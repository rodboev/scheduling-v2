// src/app/page.js

import { Suspense } from 'react'
import TechCalendar from '@/app/components/TechCalendar'

export default function CalendarPage() {
  return (
    <main>
      <h1>Tech Calendar</h1>
      <Suspense fallback={<div>Loading calendar...</div>}>
        <TechCalendar />
      </Suspense>
    </main>
  )
}
