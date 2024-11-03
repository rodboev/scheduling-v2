// src/app/components/UnassignedServices.js
import React, { useState, useRef } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/app/components/ui/popover'
import { capitalize } from '@/app/utils/capitalize'
import dayjs from 'dayjs'

function ServicePopover({ service }) {
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

  const formatTime = time => {
    return time ? dayjs(time).format('M/D h:mm A') : 'Not specified'
  }

  return (
    <Popover open={isOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mb-1 block w-full rounded-lg px-2 py-1 text-left text-sm text-neutral-500
            hover:bg-neutral-100 hover:text-black"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {capitalize(service.company) || 'Unknown Company'}
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
        {console.log(service)}
        <div>
          <h3 className="flex items-center justify-between space-x-2 pb-4 pt-1 font-bold leading-none">
            <a
              href={`https://app.pestpac.com/location/detail.asp?LocationID=${service.location?.id || ''}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div>{capitalize(service.company) || 'Unknown Company'}</div>
              <div className="font-semibold">
                #{service.location?.code || 'Unknown'}
              </div>
            </a>
          </h3>
          <div className="-mx-4 border-y-2 border-dashed border-gray-300 px-4 py-2">
            <h4 className="font-bold leading-normal">
              Unassigned: {service.reason || 'Unknown reason'}
            </h4>
          </div>
          <div className="py-4">
            <p>Preferred Time: {formatTime(service.time?.preferred)}</p>
            <p>Duration: {service.time?.duration || 'Unknown'} min</p>
            <p>Tech: {service.tech?.code || 'Not assigned'}</p>
            {service.time?.range && (
              <p>
                Calc Range: {formatTime(service.time.range[0])} -{' '}
                {formatTime(service.time.range[1])}
                {service.time.meta.originalRange &&
                  ` (from "${service.time.meta.originalRange}")`}
              </p>
            )}
          </div>
          {service.route && (
            <div className="-mx-4 border-t-2 border-dashed border-gray-300 p-3 py-3">
              <p>
                Route Time: {service.route.time.join(' - ') || 'Not specified'}
              </p>
              <p>Route Days: {service.route.days || 'Not specified'}</p>
            </div>
          )}
          {service.comments?.location?.trim() && (
            <div className="-mx-4 -mb-4 border-t-2 border-dashed border-gray-300 p-3">
              <h4 className="font-medium">Location Comments:</h4>
              <p className="break-words text-sm">{service.comments.location}</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
