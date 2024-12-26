import axios from 'axios'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start') || '2024-09-01T04:00:00.000Z'
  const end = searchParams.get('end') || '2024-09-08T03:59:59.999Z'

  const encoder = new TextEncoder()
  let isStreamClosed = false

  try {
    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (data) => {
          if (!isStreamClosed) {
            try {
              controller.enqueue(encoder.encode(data))
            } catch (error) {
              console.error('Error enqueueing data:', error)
            }
          }
        }

        try {
          // Initial progress
          safeEnqueue(
            `data: ${JSON.stringify({ type: 'progress', data: 0 })}\n\n`
          )

          // Fetch services
          const response = await axios.get(
            `http://localhost:${process.env.PORT}/api/cluster-single`,
            {
              params: { start, end }
            }
          )

          if (!isStreamClosed) {
            // Final progress
            safeEnqueue(
              `data: ${JSON.stringify({ type: 'progress', data: 1 })}\n\n`
            )

            // Send result
            safeEnqueue(
              `data: ${JSON.stringify({
                type: 'result',
                clusteredServices: response.data.clusteredServices
              })}\n\n`
            )
          }
        } catch (error) {
          console.error('Error in clustered schedule route:', error)
          if (!isStreamClosed) {
            safeEnqueue(
              `data: ${JSON.stringify({ 
                type: 'error', 
                error: error.message 
              })}\n\n`
            )
          }
        } finally {
          isStreamClosed = true
          controller.close()
        }
      },
      cancel() {
        isStreamClosed = true
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    })
  } catch (error) {
    console.error('Error fetching clustered services:', error)
    return NextResponse.json(
      { error: 'Failed to fetch clustered services' },
      { status: 500 }
    )
  }
} 