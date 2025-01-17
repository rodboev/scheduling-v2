'use client'

import React from 'react'
import { capitalize } from '@/app/utils/capitalize'
import { formatTime } from '@/app/utils/timeRange'
import dayjs from 'dayjs'
import { Car, Clock } from 'lucide-react'

function getClusterLabel(cluster, reason) {
  if (cluster >= 0) return `${cluster}`
  return `${cluster} (${reason || 'unclustered'})`
}

function formatBorough(borough) {
  if (!borough) return 'Unknown'
  if (borough === 'NJ') return 'New Jersey'
  return capitalize(borough)
}

export default function ServiceContent({ service }) {
  return (
    <div className="w-full max-w-sm text-sm leading-relaxed">
      <h3 className="leadng-none flex flex-col items-start py-1 text-base font-bold leading-none">
        <a
          href={`https://app.pestpac.com/location/detail.asp?LocationID=${service.location.id}`}
          target="_new"
        >
          <div>{capitalize(service.company)} ({service.placementOrder})</div>
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

      <div className="mt-3">
        <span className="font-semibold">{service.techId}</span> (was {service.tech.code})
      </div>
      <div>
        <span className="font-semibold">
          Cluster {getClusterLabel(service.cluster, service.clusterReason)}
        </span>
      </div>
    </div>
  )
}
