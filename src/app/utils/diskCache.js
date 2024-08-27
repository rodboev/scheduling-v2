// src/app/utils/diskCache.js

import fs from 'fs'
import path from 'path'

const CACHE_DIR = path.join(process.cwd(), 'src', 'app', 'data')

function formatDate(date) {
  const d = new Date(date)
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const year = d.getFullYear().toString().slice(-2)
  return `${month}${day}${year}`
}

function ensureCacheDirectoryExists() {
  if (!fs.existsSync(CACHE_DIR)) {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
      console.log(`Cache directory created: ${CACHE_DIR}`)
    } catch (error) {
      console.error(`Error creating cache directory: ${error.message}`)
      throw error
    }
  }
}

export function readFromDiskCache(start, end) {
  ensureCacheDirectoryExists()
  const fileName = `services-${formatDate(start)}-${formatDate(end)}.json`
  const filePath = path.join(CACHE_DIR, fileName)

  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8')
      console.log(`Cache read successfully: ${filePath}`)
      return JSON.parse(data)
    }
    console.log(`Cache file not found: ${filePath}`)
    return null
  } catch (error) {
    console.error(`Error reading from cache: ${error.message}`)
    return null
  }
}

export function writeToDiskCache(start, end, data) {
  ensureCacheDirectoryExists()
  const fileName = `services-${formatDate(start)}-${formatDate(end)}.json`
  const filePath = path.join(CACHE_DIR, fileName)

  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
    console.log(`Cache written successfully: ${filePath}`)
  } catch (error) {
    console.error(`Error writing to cache: ${error.message}`)
    throw error
  }
}
