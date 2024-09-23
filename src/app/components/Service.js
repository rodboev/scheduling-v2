// src/app/components/Service.js
import React, { useState, useRef } from 'react'
import EnforceSwitch from '@/app/components/EnforceSwitch'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/popover'
import { capitalize } from '@/app/utils/capitalize'
import { formatTime, formatTimeRange } from '@/app/utils/timeRange'
import dayjs from 'dayjs'

export default function Service({ service, updateServiceEnforcement }) {
  const [isOpen, setIsOpen] = useState(false)
  const timeoutRef = useRef(null)
  const [offset, setOffset] = useState(0)

  const pageHeight = document.documentElement.scrollHeight

  const handleMouseEnter = e => {
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

  return (
    <Popover
      open={isOpen}
      onOpenChange={setIsOpen}
    >
      <PopoverTrigger asChild>
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="inline-block text-sm leading-none">
            {formatTimeRange(service.start, service.end)} —
          </span>
          <span className="text-sm leading-none"> {service.company}</span>
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
          <EnforceSwitch
            id={`enforce-service-setup-${service.id}`}
            checked={service.tech.enforced}
            onCheckedChange={checked =>
              updateServiceEnforcement(service.id.split('-')[0], checked)
            }
          >
            Enforce tech
          </EnforceSwitch>
          <div className="text-center">Tech: {service.tech.code}</div>
        </div>

        <h3 className="leadng-none flex flex-col items-start py-1 text-base font-bold leading-none">
          <a
            href={`https://app.pestpac.com/location/detail.asp?LocationID=${service.location.id}`}
            target="_new"
          >
            <div>{capitalize(service.company)}</div>
            <div className="text-sm font-semibold">
              #{service.location.code}
            </div>
          </a>
        </h3>

        <p className="mb-2">
          {service.location.address}
          <br />
          {service.location.address2}
        </p>

        <p className="whitespace-nowrap">
          {dayjs(service.start).format('M/D')} {formatTime(service.start)} -{' '}
          {dayjs(service.end).format('M/D')} {formatTime(service.end)}
        </p>
        <p className="whitespace-nowrap">
          Preferred Time: {dayjs(service.time.preferred).format('h:mma')}
        </p>
        <p>Duration: {service.time.duration} min</p>
        <p>
          Calc Range: {dayjs(service.time.range[0]).format('h:mma')} -{' '}
          {dayjs(service.time.range[1]).format('h:mma')} (from "
          {service.time.meta.originalRange}")
        </p>

        <div className="-mx-4 my-3 border-y-2 border-dashed border-gray-300 px-4 py-1">
          <p>Route Time: {service.route.time.join(' - ')}</p>
          <p>Route Days: {service.route.days}</p>
        </div>

        {service.comments && (
          <div className="space-y-2">
            <div className="">
              <p className="break-words text-sm">
                <span className="block font-semibold">
                  Service Setup comments:
                </span>
                {service.comments.serviceSetup}
              </p>
            </div>
            {service.comments.location &&
              service.comments.location.trim() !== '' && (
                <div className="my-2">
                  <p className="break-words text-sm">
                    <span className="block font-semibold">
                      Location comments:
                    </span>
                    {service.comments.location}
                  </p>
                </div>
              )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
