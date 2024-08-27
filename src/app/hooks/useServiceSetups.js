// src/app/hooks/useServiceSetups.js

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { fetchServiceSetups } from '@/app/utils/api'

import { generateEventsForDateRange } from '@/app/utils/eventGeneration'

const ALLOWED_TECHS = [
  'CORA JOSE',
  'MADERA M.',
  'HUNTLEY E.',
  // PELLICER A',
  'RIVERS',
  'LOPEZ A.',
  'FORD J.',
  'CAPPA T.',
  'BAEZ MALIK',
  'BLAKAJ A.',
  'VASTA RICK',
]

export const useServiceSetups = (startDate, endDate) => {
  const queryClient = useQueryClient()
  const [localEnforced, setLocalEnforced] = useState({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['serviceSetups', startDate, endDate],
    queryFn: () => fetchServiceSetups(startDate, endDate),
    select: useCallback(
      (data) => {
        const filteredData = data.filter((setup) => ALLOWED_TECHS.includes(setup.tech.code))

        return filteredData.flatMap((setup) =>
          generateEventsForDateRange(setup, startDate, endDate).map((event) => ({
            ...event,
            tech: {
              ...event.tech,
              enforced: localEnforced[event.id] ?? event.tech.enforced,
            },
          })),
        )
      },
      [localEnforced, startDate, endDate],
    ),
  })

  const updateEnforced = useCallback(
    (id, enforced) => {
      const setupId = id.includes('-') ? id.split('-')[0] : id
      setLocalEnforced((prev) => ({
        ...prev,
        [setupId]: enforced,
      }))
      queryClient.invalidateQueries({ queryKey: ['serviceSetups', startDate, endDate] })
    },
    [queryClient, startDate, endDate],
  )

  const updateAllEnforced = useCallback(
    (enforced) => {
      if (data) {
        const newLocalEnforced = data.reduce((acc, setup) => {
          acc[setup.id] = enforced
          return acc
        }, {})
        setLocalEnforced(newLocalEnforced)
        queryClient.invalidateQueries({ queryKey: ['serviceSetups', startDate, endDate] })
      }
    },
    [data, queryClient, startDate, endDate],
  )

  return {
    data,
    isLoading,
    error,
    updateEnforced,
    updateAllEnforced,
  }
}
