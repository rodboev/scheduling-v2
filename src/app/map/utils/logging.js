import { logScheduleActivity } from '@/app/utils/serviceLogging'

export async function logMapActivity({ services, clusteringInfo }) {
  try {
    logScheduleActivity({ services, clusteringInfo })
  } catch (error) {
    console.error('Error logging map activity:', error)
  }
}
