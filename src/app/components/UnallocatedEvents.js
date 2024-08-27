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
                <button className="text-left text-blue-600 hover:underline">{event.title}</button>
              </PopoverTrigger>
              <PopoverContent className="w-96" side="right">
                <h3 className="mb-2 font-bold">{event.title}</h3>
                <p>
                  <strong>Intended Time:</strong>{' '}
                  {formatParsedTimeRange(event.time.range[0], event.time.range[1])}
                </p>
                <p>
                  <strong>Preferred Time:</strong>{' '}
                  {dayjs().startOf('day').add(event.time.preferred, 'second').format('h:mm A')}
                </p>
                <p>
                  <strong>Tech:</strong> {event.tech.code}
                </p>
                <p>
                  <strong>Duration:</strong> {event.time.duration} minutes
                </p>
                <p>
                  <strong>Reason:</strong>{' '}
                  {event.tech.enforced
                    ? 'No available slot for enforced tech'
                    : 'No available slot on any resource'}
                </p>
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
    </div>
  )
}
