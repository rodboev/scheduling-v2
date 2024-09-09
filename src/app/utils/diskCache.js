// src/app/utils/diskCache.js
import fs from 'fs/promises'
import path from 'path'

const CACHE_VALIDITY_HOURS = 72

function formatCacheAge(ageInHours) {
  const hours = Math.floor(ageInHours)
  const minutes = Math.round((ageInHours - hours) * 60)

  if (hours === 0) {
    return `${minutes} min`
  }
  else if (minutes === 0) {
    return `${hours} hr`
  }
  else {
    return `${hours} hr ${minutes} min`
  }
}

export async function readFromDiskCache({ file, cacheAgeAcceptable = CACHE_VALIDITY_HOURS }) {
  try {
    const filePath = path.join(process.cwd(), 'data', file)
    const data = await fs.readFile(filePath, 'utf-8')
    const { timestamp, cacheData } = JSON.parse(data)

    if (!timestamp || !cacheData) {
      console.log('Cache data is invalid')
      return null
    }

    const now = Date.now()
    const cacheTimestamp = new Date(timestamp).getTime()

    if (isNaN(cacheTimestamp)) {
      console.log('Invalid cache timestamp')
      return null
    }

    const cacheAgeHours = (now - cacheTimestamp) / (1000 * 60 * 60) // age in hours
    const formattedAge = formatCacheAge(cacheAgeHours)

    if (cacheAgeHours < cacheAgeAcceptable) {
      console.log(`Using valid cache, age: ${formattedAge}`)
      return cacheData
    }
    else {
      console.log(`Cache expired, age: ${formattedAge}`)
      return null
    }
  }
  catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Cache file not found')
      return null // File doesn't exist
    }
    console.error('Error reading cache file:', error)
    return null // Return null for any other errors
  }
}

export async function writeToDiskCache({ file, data }) {
  try {
    const filePath = path.join(process.cwd(), 'data', file)
    const cacheData = {
      timestamp: Date.now(), // Use milliseconds since epoch
      cacheData: data,
    }
    await fs.writeFile(filePath, JSON.stringify(cacheData, null, 2), 'utf-8')
    console.log('Cache written successfully')
  }
  catch (error) {
    console.error('Error writing to cache file:', error)
  }
}
