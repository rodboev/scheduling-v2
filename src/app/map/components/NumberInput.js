'use client'

import { useState, useEffect } from 'react'

function NumberInput({
  id,
  value,
  onChange,
  onChangeComplete,
  min,
  max,
  disabled = false,
}) {
  // Remove local state and just use the parent value
  // This prevents any potential state mismatches

  function handleChange(newValue) {
    // Clamp value between min and max
    const clampedValue = Math.min(Math.max(newValue, min), max)

    // Update parent state
    onChange(clampedValue)

    // Notify of completion
    onChangeComplete()
  }

  return (
    <div className="flex items-center rounded border">
      <button
        type="button"
        onClick={() => handleChange(value - 1)}
        disabled={disabled || value <= min}
        className="select-none px-3 py-2 hover:bg-gray-100 disabled:opacity-50
          disabled:hover:bg-transparent"
        aria-label="Decrease"
      >
        -
      </button>
      <span className="flex-1 select-none text-center">{value}</span>
      <button
        type="button"
        onClick={() => handleChange(value + 1)}
        disabled={disabled || value >= max}
        className="select-none px-3 py-2 hover:bg-gray-100 disabled:opacity-50
          disabled:hover:bg-transparent"
        aria-label="Increase"
      >
        +
      </button>
    </div>
  )
}

export default NumberInput
