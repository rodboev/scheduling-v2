// src/app/components/Header.js

import React from 'react'
import Logo from '@/app/components/Logo'

export default function Header({ children }) {
  return (
    <div className="flex items-center justify-between border-b p-4">
      {children}
      <div className="w-[200px]"></div>
    </div>
  )
}
