import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initInstall } from './pwa/install.js'
import { registerServiceWorker } from './pwa/register.js'

initInstall() // zachytí instalační okno prohlížeče dřív, než ho prohlížeč pošle
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
