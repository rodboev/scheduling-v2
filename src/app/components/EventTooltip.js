// src/app/components/EventTooltip.js

import React, { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Checkbox } from '@/app/components/ui/checkbox'
import { formatTimeRange, formatParsedTimeRange } from '@/app/utils/timeRange'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

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
          <span className="text-sm">({formatTimeRange(event.start, event.end)})</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-96"
        side="top"
        align="center"
        sideOffset={-30}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        animate={{}}
      >
        <h3 className="mb-2 flex items-center space-x-4 font-bold">
          <span>{event.company}</span>
          <span className="font-semibold">#{event.locationCode}</span>
        </h3>
        <p>Scheduled: {formatTimeRange(event.start, event.end)}</p>
        <p>Preferred Time: {event.time.preferred || 'N/A'}</p>
        <p>Duration: {event.time.duration || 'N/A'} min</p>
        <p>Original Range: {event.time.originalRange || 'N/A'}</p>
        <p>Calculated to: {formatParsedTimeRange(event.time.range[0], event.time.range[1])}</p>
        <div className="border-rounded-lg rounded-lg border-2 border-dashed border-gray-300 p-2">
          <p>Route Time: {event.route.time.join(' - ') || 'N/A'}</p>
          <p>Route Days: {event.route.days || 'N/A'}</p>
        </div>
        {event.comments && (
          <>
            <div className="my-2">
              <p className="break-words text-sm">
                <div className="font-semibold">Service Setup comments:</div>
                {event.comments.serviceSetup || 'N/A'}
              </p>
            </div>
            {event.comments.location && event.comments.location.trim() !== '' && (
              <div className="my-2">
                <p className="break-words text-sm">
                  <div className="font-semibold">Location comments:</div>
                  {event.comments.location}
                </p>
              </div>
            )}
          </>
        )}
        <div>Tech: {event.tech.code || 'N/A'}</div>
        <label className="checkbox-hover my-1 flex cursor-pointer items-center space-x-2">
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
