// src/app/hooks/useLocalStorage.js
import { useState, useEffect, useCallback } from 'react'

export function useLocalStorage(key, initialValue) {
  const isBrowser = typeof window !== 'undefined'

  // Initialize state with the value from localStorage or the initial value
  const [storedValue, setStoredValue] = useState(() => {
    if (!isBrowser) {
      return initialValue
    }

    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    }
    catch (error) {
      console.warn(`Error getting localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // Function to update both state and localStorage
  const setValue = useCallback(
    value => {
      if (!isBrowser) {
        console.warn(`localStorage is not available.`)
        return
      }

      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value
        setStoredValue(valueToStore)
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
      }
      catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error)
      }
    },
    [key, isBrowser, storedValue],
  )

  // Effect to sync with localStorage
  useEffect(() => {
    if (isBrowser) {
      const handleStorageChange = e => {
        if (e.key === key) {
          setStoredValue(JSON.parse(e.newValue))
        }
      }

      window.addEventListener('storage', handleStorageChange)

      return () => {
        window.removeEventListener('storage', handleStorageChange)
      }
    }
  }, [key, isBrowser])

  return [storedValue, setValue]
}
