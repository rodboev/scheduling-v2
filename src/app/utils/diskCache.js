// src/app/utils/diskCache.js

import fs from 'fs/promises'
import path from 'path'

const CACHE_FILE = path.join(process.cwd(), 'data', 'serviceSetups.json')
const CACHE_VALIDITY_HOURS = 4

function formatCacheAge(ageInHours) {
  const hours = Math.floor(ageInHours)
  const minutes = Math.round((ageInHours - hours) * 60)

  if (hours === 0) {
    return `${minutes} min`
  } else if (minutes === 0) {
    return `${hours} hr`
  } else {
    return `${hours} hr ${minutes} min`
  }
}

export async function readFromDiskCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf-8')
    const { timestamp, serviceSetups } = JSON.parse(data)

    if (!timestamp || !serviceSetups) {
      console.log('Cache data is invalid')
      return null
    }

    const now = Date.now()
    const cacheTime = new Date(timestamp).getTime()

    if (isNaN(cacheTime)) {
      console.log('Invalid cache timestamp')
      return null
    }

    const cacheAgeHours = (now - cacheTime) / (1000 * 60 * 60) // age in hours
    const formattedAge = formatCacheAge(cacheAgeHours)

    if (cacheAgeHours < CACHE_VALIDITY_HOURS) {
      console.log(`Using valid cache, age: ${formattedAge}`)
      return serviceSetups
    } else {
      console.log(`Cache expired, age: ${formattedAge}`)
      return null
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Cache file not found')
      return null // File doesn't exist
    }
    console.error('Error reading cache file:', error)
    return null // Return null for any other errors
  }
}

export async function writeToDiskCache(data) {
  try {
    const cacheData = {
      timestamp: Date.now(), // Use milliseconds since epoch
      serviceSetups: data,
    }
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2), 'utf-8')
    console.log('Cache written successfully')
  } catch (error) {
    console.error('Error writing to cache file:', error)
  }
}
