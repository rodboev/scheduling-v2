import React from 'react'

const NumberInput = ({ value, onChange, min, max }) => {
  const handleIncrement = () => {
    if (max === undefined || value < max) {
      onChange(value + 1)
    }
  }
  const handleDecrement = () => {
    if (value > min) {
      onChange(value - 1)
    }
  }
  return (
    <div className="flex items-center space-x-2">
      <button
        className="h-8 w-8 rounded-full hover:bg-muted"
        onClick={handleDecrement}
      >
        <MinusIcon className="h-4 w-4" />
      </button>
      <input
        type="text"
        value={value}
        onChange={e => {
          const newValue = Number(e.target.value)
          if (
            !isNaN(newValue) &&
            newValue >= min &&
            (max === undefined || newValue <= max)
          ) {
            onChange(newValue)
          }
        }}
        className="w-20 text-center"
      />
      <button
        className="h-8 w-8 rounded-full hover:bg-muted"
        onClick={handleIncrement}
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  )
}

function MinusIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  )
}

function PlusIcon(props) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}

export default NumberInput
