// src/app/components/UnallocatedEvents.js

import React, { useState, useRef } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/app/components/ui/popover'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { formatTimeRange } from '@/app/utils/timeRange'
import { capitalize } from '@/app/utils/capitalize'

function EventPopover({ event }) {
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
    <Popover open={isOpen}>
      <PopoverTrigger asChild>
        <button
          className="mb-1 block w-full rounded-lg px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 hover:text-black"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {capitalize(event.company) || 'Unknown Company'}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-full max-w-sm text-sm leading-relaxed"
        side="right"
        align="bottom"
        sideOffset={-20}
        alignOffset={155}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* PopoverContent remains the same */}
        <div className="">
          <h3 className="flex items-center justify-between space-x-2 pb-4 pt-1 font-bold leading-none">
            <div>{capitalize(event.company) || 'Unknown Company'}</div>
            <div className="font-semibold">#{event.locationCode || 'N/A'}</div>
          </h3>
          <div className="-mx-4 border-y-2 border-dashed border-gray-300 px-4 py-1">
            <h4 className="font-bold">Unallocated: {event.reason || 'Unknown reason'}</h4>
            <p className="text-neutral-500"></p>
          </div>
          <div className="py-4">
            <p>Preferred Time: {event.time.preferred || 'N/A'}</p>
            <p>Duration: {event.time.duration || 'N/A'} min</p>
            <p>Tech: {event.tech.code || 'N/A'}</p>
            <p>Calc Range: {formatTimeRange(event.time.range[0], event.time.range[1])}</p>
          </div>
          <div className="-mx-4 border-t-2 border-dashed border-gray-300 p-3 py-3">
            <p>Route Time: {event.route.time.join(' - ') || 'N/A'}</p>
            <p>Route Days: {event.route.days || 'N/A'}</p>
            <p>Sched code: {event.schedule.code || 'N/A'}</p>
          </div>
          {event.comments && event.comments.location && event.comments.location.trim() !== '' && (
            <div className="-mx-4 -mb-4 border-t-2 border-dashed border-gray-300 p-3">
              <h4 className="font-medium">Location Comments:</h4>
              <p className="break-words text-sm">{event.comments.location}</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function UnallocatedEvents({ events }) {
  if (!events || events.length === 0) {
    return <div className="p-4">No unallocated events</div>
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-semibold">Unallocated Events</h2>
      {events.map((event, index) => (
        <EventPopover key={index} event={event} />
      ))}
    </div>
  )
}
