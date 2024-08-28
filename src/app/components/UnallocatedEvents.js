// src/app/components/UnallocatedEvents.js

import React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Card, CardContent } from '@/app/components/ui/card'

export default function UnallocatedEvents({ events }) {
  return (
    <div className="w-64 p-4">
      <h2 className="mb-4 text-lg font-bold">Unallocated Events ({events.length})</h2>
      {events.length === 0 ? (
        <p>No unallocated events for this period.</p>
      ) : (
        <ul>
          {events.map((unallocatedEvent, index) => {
            const event = unallocatedEvent.event
            return (
              <li key={index} className="mb-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="rounded-lg px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100 hover:text-black">
                      {event.company}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full max-w-sm text-sm leading-relaxed" side="right">
                    <h3 className="mb-2 flex flex-col items-start font-bold">
                      <div>{event.company}</div>
                      <div className="text-sm font-semibold">#{event.locationCode}</div>
                    </h3>

                    <p>
                      <strong>Range:</strong> {event.time.originalRange || 'N/A'}
                    </p>
                    <p>
                      <strong>Time:</strong> {event.time.preferred}
                    </p>
                    <p>
                      <strong>Duration:</strong> {event.time.duration} minutes
                    </p>
                    <p>
                      <strong>Reason:</strong> {unallocatedEvent.reason}
                    </p>
                    <p>
                      <strong>Tech:</strong> {event.tech.code || 'N/A'}
                    </p>
                    <p>
                      <strong>Code:</strong> {event.schedule.code}
                    </p>
                    <p>
                      <strong>Description:</strong> {event.schedule.description}
                    </p>
                  </PopoverContent>
                </Popover>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
