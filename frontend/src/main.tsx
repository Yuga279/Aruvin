/**
 * ============================================================================
 * FILE: main.tsx
 * LOCATION: frontend/src/main.tsx
 * ============================================================================
 *
 * PURPOSE:
 *    Create the React root and render Aurvin under StrictMode.
 *
 * ROLE IN PROJECT:
 *    Preserves development StrictMode and global CSS while failing closed if
 *    the document root element is missing.
 *
 * KEY COMPONENTS:
 *    - Root lookup: Explicit missing-element error before createRoot.
 *    - Saved theme applied to <html> before the first render.
 *    - StrictMode render of the assembled App.
 * ============================================================================
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Imported last so the global scrollbar rules win over component stylesheets.
import './styles/scrollbars.css'
import { installScrollReveal } from './styles/scroll-reveal.ts'
import { applyTheme, readThemePreference, resolveTheme, systemPrefersLight } from './app/theme/theme.ts'

const root = document.getElementById('root')
if (!root) throw new Error('Aurvin root element is missing.')

// Apply the saved theme before the first render so there is no wrong-theme flash after load.
applyTheme(resolveTheme(readThemePreference(), systemPrefersLight()))
installScrollReveal()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
