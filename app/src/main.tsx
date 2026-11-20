import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Alleen op iPhone/iPad: maximum-scale=1 voorkomt dat Safari inzoomt zodra je in een invoerveld tikt
// (in de app op het beginscherm zoomt hij daarna niet meer terug). Knijpen om in te zoomen blijft op iOS
// gewoon werken. Op Android blokkeert maximum-scale dat wel, daarom alleen hier. Hier en niet in index.html:
// de Content-Security-Policy staat geen inline scripts toe.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
if (isIOS) {
  document
    .querySelector('meta[name=viewport]')
    ?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
