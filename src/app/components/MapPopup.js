'use client'

import React from 'react'
import { Popup } from 'react-leaflet'

export default function MapPopup({ children }) {
  return <Popup>{children}</Popup>
}
