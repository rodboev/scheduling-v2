// src/app/hooks/useLocalStorage.js

import { useState, useEffect } from 'react'

export function useLocalStorage(key, initialValue) {
  const isBrowser = typeof window !== 'undefined'

  const [storedValue, setStoredValue] = useState(() => {
    if (!isBrowser) {
      return initialValue
    }

    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.warn(`Error getting localStorage key "${key}":`, error)
      return initialValue
    }
  })

  const setValue = (value) => {
    if (!isBrowser) {
      console.warn(`localStorage is not available.`)
      return
    }

    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value
      setStoredValue(valueToStore)
      window.localStorage.setItem(key, JSON.stringify(valueToStore))
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error)
    }
  }

  const syncWithLocalStorage = () => {
    if (isBrowser) {
      const localValue = window.localStorage.getItem(key)
      if (localValue) {
        setStoredValue(JSON.parse(localValue))
      }
    }
  }

  return [storedValue, setValue, syncWithLocalStorage]
}
