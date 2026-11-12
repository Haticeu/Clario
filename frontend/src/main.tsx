import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.tsx'
import { AuthGate } from './components/auth/AuthGate'
import { ThemeProvider } from './components/ThemeProvider'
import { Toaster } from './components/Toaster'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthGate>
          <App />
        </AuthGate>
        <Toaster />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
