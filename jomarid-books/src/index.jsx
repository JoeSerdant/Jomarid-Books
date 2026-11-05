import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './sketchy.css'
import './lively.css'
import { initInstall } from './pwa/install.js'
import { registerServiceWorker } from './pwa/register.js'
import { initLang } from './i18n/core.js'

initInstall() // zachytí instalační okno prohlížeče dřív, než ho prohlížeč pošle
registerServiceWorker()

// Jazyk (a u angličtiny i její slovník) se načte dřív, než se vykreslí první obrazovka, ať se česká verze nikdy neukáže na chvilku před anglickou.
initLang().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(<App />)
})
