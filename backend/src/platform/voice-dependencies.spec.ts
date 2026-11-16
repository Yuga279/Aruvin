/**
 * ============================================================================
 * FILE: voice-dependencies.spec.ts
 * LOCATION: backend/src/platform/voice-dependencies.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify package manifests, lockfile versions, and execution scripts for voice support.
 *
 * ROLE IN PROJECT:
 *    Ensures that Nest WebSocket platform packages, ws library, and LiveKit WebRTC SDKs
 *    match required version ranges, avoid forbidden SDK bloat, and maintain build scripts.
 *
 * KEY COMPONENTS:
 *    - Direct dependency and lockfile alignment tests
 *    - SDK exclusion tests (@deepgram/sdk, @livekit/agents, @livekit/components-react)
 *    - Build and test script integrity tests
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const backend = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const frontend = JSON.parse(readFileSync(new URL('../../../frontend/package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const frontendLock = JSON.parse(readFileSync(new URL('../../../frontend/package-lock.json', import.meta.url), 'utf8'));

describe('voice dependency contract', () => {
  it('declares matching Nest ws transport, direct ws, and pinned LiveKit SDKs without bloat', () => {
    expect(backend.dependencies['@nestjs/websockets']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies['@nestjs/platform-ws']).toBe(backend.dependencies['@nestjs/common']);
    expect(backend.dependencies.ws).toBe('^8.18.0');
    expect(backend.dependencies['@livekit/rtc-node']).toBe('^1.2.1');
    expect(backend.dependencies['livekit-server-sdk']).toBe('^2.19.2');
    expect(backend.devDependencies['@types/ws']).toBe('^8.5.14');
    for (const name of ['@nestjs/websockets', '@nestjs/platform-ws', 'ws', '@livekit/rtc-node', 'livekit-server-sdk']) {
      expect(lock.packages[''].dependencies[name]).toBe(backend.dependencies[name]);
      expect(lock.packages[`node_modules/${name}`]?.version).toBeTruthy();
    }
    expect(lock.packages[''].devDependencies['@types/ws']).toBe('^8.5.14');
    expect(lock.packages['node_modules/@types/ws'].version).toBeTruthy();
    for (const forbidden of ['@deepgram/sdk', '@livekit/agents', 'livekit-client']) {
      expect(backend.dependencies[forbidden]).toBeUndefined();
      expect(backend.devDependencies[forbidden]).toBeUndefined();
    }
    expect(frontend.dependencies).toEqual({
      '@ozymandiasthegreat/vad': '2.0.7',
      'livekit-client': '^2.23.0',
      react: '^19.2.8',
      'react-dom': '^19.2.8',
    });
    expect(frontendLock.packages[''].dependencies['@ozymandiasthegreat/vad']).toBe('2.0.7');
    expect(frontendLock.packages['node_modules/@ozymandiasthegreat/vad'].version).toBe('2.0.7');
    expect(frontendLock.packages[''].dependencies['livekit-client']).toBe('^2.23.0');
    expect(frontendLock.packages['node_modules/livekit-client']?.version).toBeTruthy();
    const allFrontend = { ...frontend.dependencies, ...frontend.devDependencies };
    for (const name of [
      'ws',
      '@types/ws',
      '@deepgram/sdk',
      '@nestjs/websockets',
      '@nestjs/platform-ws',
      '@livekit/agents',
      '@livekit/components-react',
      '@livekit/rtc-node',
      'livekit-server-sdk',
    ]) {
      expect(allFrontend[name]).toBeUndefined();
    }
  });
  it('retains runnable existing build and verification scripts', () => {
    expect(backend.scripts.build).toBe('nest build');
    expect(backend.scripts.test).toBe('vitest run');
    expect(backend.scripts.lint).toBe('oxlint --type-aware src/ test/');
    expect(backend.scripts['test:e2e']).toBe('vitest run --config ./vitest.config.e2e.ts');
    expect(frontend.scripts.build).toBe('tsc -b && vite build');
    expect(frontend.scripts.test).toBe('vitest run');
    expect(frontend.scripts.lint).toBe('oxlint');
  });
});
