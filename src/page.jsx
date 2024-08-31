// app/page.js

import React from 'react'
import ReactDOM from 'react-dom/client'
import Providers from '@/Providers'
import Home from '@/components/Home'
import '@/styles/globals.css'

ReactDOM.createRoot(document.body).render(
  <React.StrictMode>
    <Providers>
      <Home />
    </Providers>
  </React.StrictMode>,
)
