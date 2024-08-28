// In UnallocatedEvents.js

import React from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/app/components/ui/popover'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

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
            <button className="rounded-lg px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100 hover:text-black">
              {event.company || 'Unknown Company'}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">{event.title || 'Untitled Event'}</h4>
                <p className="text-sm text-neutral-500">
                  {dayjs(event.start).format('MM/DD/YYYY HH:mm')} -{' '}
                  {dayjs(event.end).format('MM/DD/YYYY HH:mm')}
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Reason for Unallocation</h4>
                <p className="text-sm text-neutral-500">{event.reason || 'No reason provided'}</p>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  )
}
