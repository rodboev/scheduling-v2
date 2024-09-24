import { Progress } from '@/app/components/ui/progress'

export default function ProgressBar({ schedulingStatus, schedulingProgress }) {
  const progressPercentage = Math.round(schedulingProgress * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/50">
      <div className="w-80 space-y-5 rounded-lg border p-5 backdrop-blur-md">
        <p className="text-center">{schedulingStatus}</p>
        <Progress
          value={progressPercentage}
          className="w-full"
        />
      </div>
    </div>
  )
}
