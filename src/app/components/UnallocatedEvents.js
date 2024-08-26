// src/app/components/UnallocatedEvents.js

import React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { formatParsedTimeRange } from '@/app/utils/timeRange'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export default function UnallocatedEvents({ events }) {
  return (
    <div className="w-64 border-r p-4">
      <h2 className="mb-4 text-lg font-bold">Unallocated Events</h2>
      <ul>
        {events.map((event, index) => (
          <li key={index} className="mb-2">
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-left text-blue-600 hover:underline">
                  {event.event.title}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-96" side="right">
                <h3 className="mb-2 font-bold">{event.event.title}</h3>
                <p>
                  <strong>Reason:</strong> {event.reason}
                </p>
                <p>
                  <strong>Intended Time:</strong>{' '}
                  {formatParsedTimeRange(event.event.time.range[0], event.event.time.range[1])}
                </p>
                <p>
                  <strong>Preferred Time:</strong> {event.event.time.preferred}
                </p>
                <p>
                  <strong>Tech:</strong> {event.event.tech.code}
                </p>
                <p>
                  <strong>Duration:</strong> {event.event.time.duration} minutes
                </p>
                {event.conflictingEvents && event.conflictingEvents.length > 0 && (
                  <div>
                    <p className="mt-2 font-bold">Conflicting Events:</p>
                    <ul>
                      {event.conflictingEvents.map((conflictingEvent, i) => (
                        <li key={i}>
                          {conflictingEvent.title} ({dayjs(conflictingEvent.start).format('h:mma')}{' '}
                          - {dayjs(conflictingEvent.end).format('h:mma')})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
    </div>
  )
}
