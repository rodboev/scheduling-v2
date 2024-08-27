// src/app/components/EventTooltip.js

import React, { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Checkbox } from '@/app/components/ui/checkbox'
import { formatParsedTimeRange } from '@/app/utils/timeRange'

export default function EventTooltip({ event, handleEnforceTechChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const timeoutRef = useRef(null)

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current)
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 300)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <span>{event.title} </span>
          <span className="text-sm">
            ({formatParsedTimeRange(event.time.range[0], event.time.range[1])})
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-80"
        side="top"
        align="center"
        sideOffset={-30}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <h3 className="mb-2 font-bold">{event.title}</h3>
        <p>Range: {formatParsedTimeRange(event.time.range[0], event.time.range[1])}</p>
        <p>Tech: {event.tech.code}</p>
        <label className="checkbox-hover mt-2 flex cursor-pointer items-center space-x-2">
          <Checkbox
            checked={event.tech.enforced}
            onCheckedChange={(checked) => handleEnforceTechChange(event.tech.code, checked)}
          />
          <span>Enforce Tech</span>
        </label>
      </PopoverContent>
    </Popover>
  )
}
