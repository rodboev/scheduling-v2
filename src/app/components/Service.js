// src/app/components/Service.js
'use client'

import React, { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { formatTimeRange } from '@/app/utils/timeRange'
import ServiceContent from '@/app/components/ServiceContent'

export default function Service({ service }) {
  const [isOpen, setIsOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const pageHeight = typeof document !== 'undefined' ? document.documentElement.scrollHeight : 0

  const handleMouseEnter = e => {
    const cursorY = e.clientY + (typeof window !== 'undefined' ? window.scrollY : 0)
    setOffset(pageHeight - cursorY)
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    setIsOpen(false)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <span className="inline-block text-sm leading-none">
            {formatTimeRange(service.start, service.end)} —
          </span>
          <span className="text-sm leading-none"> {service.company}</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-full max-w-sm text-sm leading-relaxed transition-opacity duration-150"
        side="top"
        align="right"
        sideOffset={offset < 300 ? -50 : -300}
        alignOffset={260}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <ServiceContent service={service} />
      </PopoverContent>
    </Popover>
  )
}
