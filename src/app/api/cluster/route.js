import { calculateDistancesForShift } from '@/app/scheduling/distance'
import { clusterServices } from '@/app/utils/clustering'
import axios from 'axios'
import { NextResponse } from 'next/server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    if (!start || !end) {
      return NextResponse.json(
        { error: 'Missing start or end date' },
        { status: 400 },
      )
    }

    const servicesResponse = await axios.get(
      `http://localhost:${process.env.PORT}/api/services`,
      {
        params: { start, end },
      },
    )

    const services = servicesResponse.data
    const distanceMatrix = await calculateDistancesForShift({ services })

    if (!distanceMatrix) {
      console.error('Failed to calculate distance matrix')
      return NextResponse.json(
        { error: 'Failed to calculate distances' },
        { status: 500 },
      )
    }

    const clusteredServices = clusterServices(services, distanceMatrix)
    return NextResponse.json(clusteredServices)
  } catch (error) {
    console.error('Error in cluster API:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    )
  }
}
