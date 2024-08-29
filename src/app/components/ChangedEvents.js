// src/app/components/ChangedEvents.js

import React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { dayjsInstance as dayjs } from '@/app/utils/dayjs'

export default function ChangedEvents({ events }) {
  return (
    <div className="w-64 border-r p-4">
      <h2 className="mb-4 text-lg font-bold">Changed Events</h2>
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
                  <strong>New Range:</strong> {event.newRange}
                </p>
                <p>
                  <strong>Preferred Time:</strong>{' '}
                  {dayjs()
                    .startOf('day')
                    .add(event.event.time.preferred, 'second')
                    .format('h:mm A')}
                </p>
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
    </div>
  )
}
