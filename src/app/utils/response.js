import { NextResponse } from 'next/server'

/**
 * Creates a JSON response with proper formatting and headers
 * @param {any} data - The data to send in the response
 * @param {Object} options - Additional options for the response
 * @returns {NextResponse} A properly formatted JSON response
 */
export function createJsonResponse(data, options = {}) {
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    ...options,
  })
}
