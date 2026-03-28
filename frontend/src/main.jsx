import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

if (import.meta.env.DEV) {
  const ignored = [
    '[vite] connecting',
    '[vite] connected',
    'Download the React DevTools',
    'Error handling response: TypeError: Cannot read properties of undefined (reading \'toLowerCase\')',
    'chrome-extension://jjhdaoppcengemgjjaccioikanoodeol'
  ]

  const shouldIgnore = (args) =>
    args.some((arg) => {
      if (typeof arg === 'string') {
        return ignored.some((snippet) => arg.includes(snippet))
      }
      if (arg && typeof arg === 'object') {
        const message = String(arg.message || '')
        const stack = String(arg.stack || '')
        return ignored.some((snippet) => message.includes(snippet) || stack.includes(snippet))
      }
      return false
    })

  const wrap = (original) => (...args) => {
    if (shouldIgnore(args)) return
    original(...args)
  }

  console.log = wrap(console.log)
  console.info = wrap(console.info)
  console.warn = wrap(console.warn)
  console.error = wrap(console.error)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
