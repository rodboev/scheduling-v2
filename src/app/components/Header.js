// src/app/components/Header.js
import React from 'react'
import { Button } from '@/app/components/ui/button'

export default function Header({ children, onForceReschedule }) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center space-x-4">{children}</div>
      <Button onClick={onForceReschedule}>Force Reschedule</Button>
    </header>
  )
}
