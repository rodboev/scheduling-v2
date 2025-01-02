// src/app/components/Service.js
'use client'

import React, { useState, useRef, Suspense } from 'react'
import EnforceSwitch from '@/app/calendar/EnforceSwitch'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { capitalize } from '@/app/utils/capitalize'
import { formatTime, formatTimeRange } from '@/app/utils/timeRange'
import { TECH_SPEED_MPH } from '@/app/utils/constants'
import { calculateTravelTime } from '@/app/map/utils/travelTime'
import dayjs from 'dayjs'
import { Car, Clock } from 'lucide-react'
import { Popup } from 'react-leaflet'

function getClusterLabel(cluster, reason) {
  if (cluster >= 0) return `${cluster}`
  return `${cluster} (${reason || 'unclustered'})`
}

function formatBorough(borough) {
  if (!borough) return 'Unknown'
  if (borough === 'NJ') return 'New Jersey'
  return capitalize(borough)
}

export default function Service({ service, updateServiceEnforcement, variant = 'calendar' }) {
  const [isOpen, setIsOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const pageHeight = typeof document !== 'undefined' ? document.documentElement.scrollHeight : 0

  const handleMouseEnter = e => {
    if (variant === 'calendar') {
      const cursorY = e.clientY + (typeof window !== 'undefined' ? window.scrollY : 0)
      setOffset(pageHeight - cursorY)
    }
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    setIsOpen(false)
  }

  const ServiceContent = () => (
    <div className="w-full max-w-sm text-sm leading-relaxed">
      {/* {updateServiceEnforcement && (
        <div className="float-right mb-2 ml-4">
          <EnforceSwitch
            id={`enforce-service-setup-${service.id}`}
            checked={service.tech.enforced}
            onCheckedChange={checked => updateServiceEnforcement(service.id.split('-')[0], checked)}
          >
            Enforce tech
          </EnforceSwitch>
          <div className="text-center">Tech: {service.tech.code}</div>
        </div>
      )} */}

      <h3 className="leadng-none flex flex-col items-start py-1 text-base font-bold leading-none">
        <a
          href={`https://app.pestpac.com/location/detail.asp?LocationID=${service.location.id}`}
          target="_new"
        >
          <div>{capitalize(service.company)}</div>
          <div className="text-sm font-semibold">#{service.location.code}</div>
        </a>
      </h3>

      {service.borough && (
        <div className="mb-2 font-semibold">Borough: {formatBorough(service.borough)}</div>
      )}

      {/* Format time display based on available data */}
      {service?.start && service?.end && (
        <div className="my-2 flex items-center gap-x-2 font-semibold">
          <Clock strokeWidth={2.5} className="h-4 w-4" />
          <span className="leading-none">
            {dayjs(service.time.range[0]).format('M/D')} {formatTime(service.start)} -{' '}
            {formatTime(service.end)}
          </span>
        </div>
      )}

      {/* Distance from previous point */}
      {service.distanceFromPrevious > 0 && (
        <div className="mb-2">
          <div className="flex items-center gap-x-2">
            <Car size={32} strokeWidth={2.5} className="h-4 w-4" />
            <span className="whitespace-nowrap font-semibold">
              {service.distanceFromPrevious.toFixed(2)} mi
            </span>
          </div>
          <div className="text-xs text-gray-600">
            {service.travelTimeFromPrevious} min from {service.previousCompany}
          </div>
        </div>
      )}

      <div className="mb-2">
        {service.location.address}
        <br />
        {service.location.address2}
      </div>

      <div className="whitespace-nowrap">
        Preferred Time: {dayjs(service.time.preferred).format('M/D h:mma')}
      </div>
      <div>Duration: {service.time.duration} min</div>
      <div>
        Time Range: {dayjs(service.time.range[0]).format('M/D h:mma')} -{' '}
        {dayjs(service.time.range[1]).format('h:mma')}
      </div>

      {service.route && (
        <div className="-mx-4 my-3 border-y-2 border-dashed border-gray-300 px-4 py-1">
          <div>Route Time: {service.route?.time.join(' - ')}</div>
          <div>Route Days: {service.route?.days}</div>
        </div>
      )}

      {service.cluster !== undefined && (
        <div className="mt-3">
          <span className="font-semibold">
            Cluster: {getClusterLabel(service.cluster, service.clusterReason)}
          </span>{' '}
          (was {service.tech.code})
        </div>
      )}
    </div>
  )

  if (variant === 'map') {
    return (
      <Popup>
        <ServiceContent />
      </Popup>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <span className="inline-block text-sm leading-none">
            {formatTimeRange(service.start, service.end)} —
          </span>
          <span className="text-sm leading-none"> {service.company}</span>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-full max-w-sm text-sm leading-relaxed transition-opacity duration-150"
        side="top"
        align="right"
        sideOffset={offset < 300 ? -50 : -300}
        alignOffset={260}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <ServiceContent />
      </PopoverContent>
    </Popover>
  )
}
