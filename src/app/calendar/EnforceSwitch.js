import React from 'react'
import { Card, CardContent } from '@/app/components/ui/card'
import { Label } from '@/app/components/ui/label'
import { Switch } from '@/app/components/ui/switch'

export default function EnforceSwitch({ id, checked, onCheckedChange, children }) {
  return (
    <Card className="w-fit overflow-hidden hover:border-neutral-300 hover:bg-neutral-100">
      <CardContent className="w-fit p-0">
        <Label htmlFor={id} className="flex cursor-pointer items-center space-x-3 p-3 px-4">
          <Switch
            className="focus-visible:ring-transparent"
            checked={checked}
            onCheckedChange={onCheckedChange}
            id={id}
          />
          <span className="whitespace-nowrap">{children}</span>
        </Label>
      </CardContent>
    </Card>
  )
}
