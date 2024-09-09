// src/app/components/Header.js
import React from 'react'

export default function Header({ children }) {
  return <header className="flex items-center justify-between border-b p-4">{children}</header>
}
