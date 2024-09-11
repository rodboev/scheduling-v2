// src/app/components/UnassignedServices.js
import React, { useState, useRef } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/app/components/ui/popover'
import { capitalize } from '@/app/utils/capitalize'
import { formatTimeRange } from '@/app/utils/timeRange'

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

  return (
    <Popover open={isOpen}>
      <PopoverTrigger asChild>
        <button
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
        {/* PopoverContent remains the same */}
        <div className="">
          <h3 className="flex items-center justify-between space-x-2 pb-4 pt-1 font-bold leading-none">
            <a
              href={`https://app.pestpac.com/location/detail.asp?LocationID=${service.location.id}`}
              target="_new"
            >
              <div>{capitalize(service.company) || 'Unknown Company'}</div>
              <div className="font-semibold">#{service.location.code}</div>
            </a>
          </h3>
          <div className="-mx-4 border-y-2 border-dashed border-gray-300 px-4 py-1">
            <h4 className="font-bold">
              Unassigned: {service.reason || 'Unknown reason'}
            </h4>
            <p className="text-neutral-500"></p>
          </div>
          <div className="py-4">
            <p>Preferred Time: {service.time.preferred}</p>
            <p>Duration: {service.time.duration} min</p>
            <p>Tech: {service.tech.code}</p>
            <p>
              Calc Range:{' '}
              {formatTimeRange(service.time.range[0], service.time.range[1])}
            </p>
            <p>Original: {service.time.originalRange}</p>
          </div>
          <div className="-mx-4 border-t-2 border-dashed border-gray-300 p-3 py-3">
            <p>Route Time: {service.route.time.join(' - ')}</p>
            <p>Route Days: {service.route.days}</p>
          </div>
          {service.comments &&
            service.comments.location &&
            service.comments.location.trim() !== '' && (
              <div className="-mx-4 -mb-4 border-t-2 border-dashed border-gray-300 p-3">
                <h4 className="font-medium">Location Comments:</h4>
                <p className="break-words text-sm">
                  {service.comments.location}
                </p>
              </div>
            )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default function UnassignedServices({ services }) {
  if (!services || services.length === 0) {
    return <div className="p-4">No unassigned services</div>
  }

  return (
    <div className="p-4">
      <h2 className="mb-4 text-lg font-semibold">Unassigned Services</h2>
      {services.map((service, index) => (
        <ServicePopover
          key={index}
          service={service}
        />
      ))}
    </div>
  )
}
