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
    <div className="relative -left-2 flex">
      <div className="flex">
        <button
          className="flex items-center justify-center rounded-full p-2 hover:bg-muted"
          onClick={handleDecrement}
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <div className="flex cursor-default items-center justify-center px-2 text-center">
          {value}
        </div>
      </div>
      <div className="flex">
        <button
          className="flex items-center justify-center rounded-full p-2 hover:bg-muted"
          onClick={handleIncrement}
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
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
