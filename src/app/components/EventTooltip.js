// src/app/components/EventTooltip.js

import React, { useState, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Switch } from '@/app/components/ui/switch'
import { formatTimeRange } from '@/app/utils/timeRange'
import { Label } from '@/app/components/ui/label'
import { Card, CardContent } from '@/app/components/ui/card'
import { capitalize } from '@/app/utils/capitalize'

export default function EventTooltip({ event, handleEnforceTechChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const timeoutRef = useRef(null)
  const [offset, setOffset] = useState(0)

  const pageHeight = document.documentElement.scrollHeight

  const handleMouseEnter = (e) => {
    const cursorY = e.clientY + window.scrollY
    setOffset(pageHeight - cursorY)
    clearTimeout(timeoutRef.current)
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 300)
  }

  const cursorY = e.clientY + window.scrollY

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <span className="inline-block text-sm leading-none">
            {formatTimeRange(event.start, event.end)} —
          </span>
          <span className="text-sm leading-none"> {capitalize(event.company)} </span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-full max-w-sm text-sm leading-relaxed"
        side="top"
        align="right"
        sideOffset={offset < 300 ? -50 : -300}
        alignOffset={260}
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

        <h3 className="leadng-none flex flex-col items-start py-1 text-base font-bold leading-none">
          <div>{capitalize(event.company)}</div>
          <div className="text-sm font-semibold">#{event.locationCode}</div>
        </h3>

        <p className="whitespace-nowrap">Scheduled: {formatTimeRange(event.start, event.end)}</p>
        <p className="whitespace-nowrap">Preferred Time: {event.time.preferred || 'N/A'}</p>
        <p>Duration: {event.time.duration || 'N/A'} min</p>
        <p>Original Range: {event.time.originalRange || 'N/A'}</p>
        <p>Calculated to: {formatTimeRange(event.time.range[0], event.time.range[1])}</p>

        <div className="-mx-4 my-3 border-y-2 border-dashed border-gray-300 px-4 py-1">
          <p>Route Time: {event.route.time.join(' - ') || 'N/A'}</p>
          <p>Route Days: {event.route.days || 'N/A'}</p>
        </div>

        {event.comments && (
          <div className="space-y-2">
            <div className="">
              <p className="break-words text-sm">
                <span className="block font-semibold">Service Setup comments:</span>
                {event.comments.serviceSetup || 'N/A'}
              </p>
            </div>
            {event.comments.location && event.comments.location.trim() !== '' && (
              <div className="my-2">
                <p className="break-words text-sm">
                  <span className="block font-semibold">Location comments:</span>
                  {event.comments.location}
                </p>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
