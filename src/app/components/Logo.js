// src/app/components/Logo.js
import Link from 'next/link'

import React from 'react'

export default function Logo() {
  return (
    <div className="logo flex-grow text-center tracking-tighter">
      <Link href="/">
        <span className="display-inline mx-1 text-5xl font-bold text-teal-500">liberty</span>
        <span className="display-inline mx-1 text-2xl">schedule</span>
      </Link>
    </div>
  )
}
