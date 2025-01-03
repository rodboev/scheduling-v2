import { logScheduleActivity } from '@/app/utils/serviceLogging'

export async function logMapActivity({ services, clusteringInfo }) {
  try {
    // If no clustering info, create a basic one
    const info = clusteringInfo || {
      algorithm: 'shifts',
      performanceDuration: 0,
      connectedPointsCount: services.filter(s => s.cluster >= 0).length,
      totalClusters: new Set(services.map(s => s.cluster).filter(c => c >= 0)).size,
      clusterSizes: services.reduce((acc, service) => {
        if (service.cluster >= 0) {
          acc[service.cluster] = (acc[service.cluster] || 0) + 1
        }
        return acc
      }, []),
    }

    await logScheduleActivity({
      services,
      clusteringInfo: info,
    })
  } catch (error) {
    console.error('Error logging schedule activity:', error)
  }
}
