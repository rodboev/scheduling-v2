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
          <span>{event.company} </span>
          <span className="text-sm">({formatParsedTimeRange(event.start, event.end)})</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-96"
        side="top"
        align="center"
        sideOffset={-30}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <h3 className="mb-2 flex items-center justify-between font-bold">
          <span>{event.company}</span>
          <span className="text-sm font-semibold text-gray-600">{event.locationCode}</span>
        </h3>
        <p>Scheduled: {formatParsedTimeRange(event.start, event.end)}</p>
        <p>Original Range: {event.time.originalRange || 'N/A'}</p>
        <p>Tech: {event.tech.code || 'N/A'}</p>
        {event.comments && (
          <div className="mt-2">
            <p className="text-sm">
              <div className="font-semibold">Service Setup:</div>
              {event.comments.serviceSetup || 'N/A'}
            </p>
            {event.comments.location && event.comments.location.trim() !== '' && (
              <p className="text-sm">
                <div className="font-semibold">Location:</div>
                {event.comments.location}
              </p>
            )}
          </div>
        )}
        <label className="checkbox-hover mt-2 flex cursor-pointer items-center space-x-2">
          <Checkbox
            checked={event.tech.enforced || false}
            onCheckedChange={(checked) => handleEnforceTechChange(event.id, checked)}
          />
          <span>Enforce Tech</span>
        </label>
      </PopoverContent>
    </Popover>
  )
}
