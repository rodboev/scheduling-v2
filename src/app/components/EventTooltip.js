// src/app/components/EventTooltip.js

import React, { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Switch } from '@/app/components/ui/switch'
import { formatTimeRange, formatParsedTimeRange } from '@/app/utils/timeRange'
import { Label } from '@/app/components/ui/label'
import { Card, CardContent } from '@/app/components/ui/card'

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
        className="w-full max-w-sm text-sm leading-relaxed"
        side="top"
        align="center"
        sideOffset={-300}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="float-right mb-2 ml-4">
          <Card className="mb-2 w-fit overflow-hidden hover:border-neutral-300 hover:bg-neutral-100">
            <CardContent className="w-fit p-0">
              <Label
                htmlFor={`enforce-tech-${event.id}`}
                className="flex cursor-pointer items-center space-x-3 p-3 px-4"
              >
                <Switch
                  className="focus-visible:ring-transparent"
                  checked={event.tech.enforced || false}
                  onCheckedChange={(checked) => handleEnforceTechChange(event.id, checked)}
                  id={`enforce-tech-${event.id}`}
                />
                <span className="whitespace-nowrap">Enforce Tech</span>
              </Label>
            </CardContent>
          </Card>
          <div className="text-center">Tech: {event.tech.code || 'N/A'}</div>
        </div>

        <h3 className="mb-2 flex flex-col items-start font-bold">
          <div>{event.company}</div>
          <div className="text-sm font-semibold">#{event.locationCode}</div>
        </h3>

        <p>Scheduled: {formatTimeRange(event.start, event.end)}</p>
        <p>Preferred Time: {event.time.preferred || 'N/A'}</p>
        <p>Duration: {event.time.duration || 'N/A'} min</p>
        <p>Original Range: {event.time.originalRange || 'N/A'}</p>
        <p>Calculated to: {formatParsedTimeRange(event.time.range[0], event.time.range[1])}</p>
        <div className="border-rounded-lg my-1 w-fit rounded-lg border-2 border-dashed border-gray-300 px-2 py-1">
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
      </PopoverContent>
    </Popover>
  )
}
