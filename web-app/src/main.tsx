import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/console" element={<App />} />
        <Route path="/inbox" element={<App />} />
        <Route path="/canvas" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
)