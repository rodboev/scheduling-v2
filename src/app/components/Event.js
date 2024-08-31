// src/app/components/Event.js

import React from 'react'
import EventTooltip from '@/app/components/EventTooltip'
import { Switch } from '@/app/components/ui/switch'
import { Label } from '@/app/components/ui/label'
import { Card, CardContent } from '@/app/components/ui/card'

export default function Event({ event, updateEnforced, enforcedServiceSetups }) {
  const setupId = event.id.split('-')[0]
  const enforced = enforcedServiceSetups[setupId] ?? event.tech.enforced

  return (
    <EventTooltip
      event={{
        ...event,
        tech: {
          ...event.tech,
          enforced: enforced,
        },
      }}
    >
      <Card className="mb-2 w-fit overflow-hidden hover:border-neutral-300 hover:bg-neutral-100">
        <CardContent className="w-fit p-0">
          <Label
            htmlFor={`enforce-service-setup-${event.id}`}
            className="flex cursor-pointer items-center space-x-3 p-3 px-4"
          >
            <Switch
              className="focus-visible:ring-transparent"
              checked={enforced}
              onCheckedChange={(checked) => updateEnforced(event.id, checked)}
              id={`enforce-service-setup-${event.id}`}
            />
            <span className="whitespace-nowrap">Enforce tech</span>
          </Label>
        </CardContent>
      </Card>
    </EventTooltip>
  )
}
