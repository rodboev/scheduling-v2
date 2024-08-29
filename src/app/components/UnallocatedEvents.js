// src/app/components/UnallocatedEvents.js

import React from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/app/components/ui/popover'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'
import { formatTimeRange } from '@/app/utils/timeRange'
import { capitalize } from '@/app/utils/capitalize'

export default function UnallocatedEvents({ events }) {
  if (!events || events.length === 0) {
    return <div className="p-4">No unallocated events</div>
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-semibold">Unallocated Events</h2>
      {events.map((event, index) => (
        <Popover key={index}>
          <PopoverTrigger asChild>
            <button className="mb-1 block w-full rounded-lg px-2 py-1 text-left text-sm text-neutral-500 hover:bg-neutral-100 hover:text-black">
              {capitalize(event.company) || 'Unknown Company'}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-full max-w-sm text-sm leading-relaxed"
            side="right"
            align="bpttom"
            sideOffset={-195}
            alignOffset={220}
          >
            <div className="">
              <h3 className="flex items-center justify-between space-x-2 pb-4 pt-1 font-bold leading-none">
                <div>{capitalize(event.company) || 'Unknown Company'}</div>
                <div className="font-semibold">#{event.locationCode || 'N/A'}</div>
              </h3>
              <div className="-mx-4 border-y-2 border-dashed border-gray-300 px-4 py-1">
                <h4 className="font-bold">{event.reason || 'No cancellation reason provided'}</h4>
                <p className="text-neutral-500"></p>
              </div>
              <div className="py-4">
                <p>Scheduled: {formatTimeRange(event.start, event.end)}</p>
                <p>Preferred Time: {event.time.preferred || 'N/A'}</p>
                <p>Duration: {event.time.duration || 'N/A'} min</p>
                <p>Calc Range: {formatTimeRange(event.time.range[0], event.time.range[1])}</p>
                <p>Tech: {event.tech.code || 'N/A'}</p>
              </div>
              <div className="-mx-4 border-t-2 border-dashed border-gray-300 p-3 py-3">
                <p>Original Range: {event.time.originalRange || 'N/A'}</p>
                <p>Route Time: {event.route.time.join(' - ') || 'N/A'}</p>
                <p>Route Days: {event.route.days || 'N/A'}</p>
                <p>Sched code: {event.schedule.code || 'N/A'}</p>
              </div>
              {event.comments &&
                event.comments.location &&
                event.comments.location.trim() !== '' && (
                  <div className="-mx-4 -mb-4 border-t-2 border-dashed border-gray-300 p-3">
                    <h4 className="font-medium">Location Comments:</h4>
                    <p className="break-words text-sm">{event.comments.location}</p>
                  </div>
                )}
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}
