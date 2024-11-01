'use client'

import React from 'react'
import { capitalize } from '@/app/utils/capitalize'
import { formatTime } from '@/app/utils/timeRange'
import dayjs from 'dayjs'
import { Car } from 'lucide-react'
import { Popup } from 'react-leaflet'

const MapPopup = ({ service, updateServiceEnforcement }) => {
  function getClusterLabel(cluster, reason) {
    if (cluster >= 0) return `${cluster}`
    return `${cluster} (${reason || 'unclustered'})`
  }

  return (
    <Popup>
      <div className="w-full max-w-sm text-sm leading-relaxed">
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

        {service.distanceFromPrevious && (
          <div className="mb-2">
            <div className="flex items-center gap-x-1">
              <span>
                <Car />
              </span>
              <span className="whitespace-nowrap font-bold">
                {service.distanceFromPrevious?.toFixed(2)} mi
              </span>
            </div>
            {service.previousCompany && (
              <div className="text-xs text-gray-600">
                from {service?.previousCompany}
              </div>
            )}
          </div>
        )}

        <div className="mb-2">
          {service.location.address}
          <br />
          {service.location.address2}
        </div>

        {service.start && service.end && (
          <div className="whitespace-nowrap">
            {dayjs(service.start).format('M/D')} {formatTime(service.start)} -{' '}
            {dayjs(service.end).format('M/D')} {formatTime(service.end)}
          </div>
        )}

        {service.time.visited && (
          <div className="whitespace-nowrap">
            Scheduled: {dayjs(service.time.visited).format('M/D h:mma')} - {dayjs(service.time.visited).add(service.time.duration, 'minutes').format('h:mma')}
          </div>
        )}

        <div className="whitespace-nowrap">
          Preferred Time: {dayjs(service.time.preferred).format('h:mma')}
        </div>
        <div>Duration: {service.time.duration} min</div>
        <div>
          Time Range: {dayjs(service.time.range[0]).format('M/D')}{' '}
          {dayjs(service.time.range[0]).format('h:mma')} -{' '}
          {dayjs(service.time.range[1]).format('h:mma')}
        </div>

        {service.cluster !== undefined && (
          <div className="mt-3 font-bold">
            Cluster: {getClusterLabel(service.cluster, service.clusterReason)}
            {service.wasStatus && service.cluster !== service.wasStatus
              ? ` (was ${service.wasStatus})`
              : ''}
          </div>
        )}
      </div>
    </Popup>
  )
}

export default MapPopup
