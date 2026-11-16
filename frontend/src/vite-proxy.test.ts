/**
 * ============================================================================
 * FILE: vite-proxy.test.ts
 * LOCATION: frontend/src/vite-proxy.test.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify Vite development proxy configuration for WebSocket upgrades.
 *
 * ROLE IN PROJECT:
 *    Ensures that /api routes proxy both HTTP and WebSocket connections to
 *    the backend target with changeOrigin and ws: true enabled.
 *
 * KEY COMPONENTS:
 *    - Proxy upgrade test: verifies ws: true, changeOrigin: true, and target.
 * ============================================================================
 */

import { expect, it } from 'vitest'
import config from '../vite.config.ts'

it('upgrades the same-origin /api proxy and does not change its target', () => {
  const proxy = config.server?.proxy?.['/api']
  if (!proxy || typeof proxy === 'string') throw new Error('missing /api proxy')
  expect(proxy.ws).toBe(true)
  expect(proxy.changeOrigin).toBe(true)
  expect(proxy.target).toBe(process.env.BACKEND_PROXY_TARGET ?? 'http://localhost:3000')
})
