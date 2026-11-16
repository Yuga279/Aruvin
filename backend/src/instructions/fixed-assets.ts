/**
 * ============================================================================
 * FILE: fixed-assets.ts
 * LOCATION: backend/src/instructions/fixed-assets.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Load, validate, and hash immutable Phase 1 instruction and knowledge files.
 *
 * ROLE IN PROJECT:
 *    Supplies frozen, versioned fixed assets to context assembly at startup so
 *    later turns cannot hot-reload instructions or silently accept stale files.
 *
 * KEY COMPONENTS:
 *    - validateAsset: Strict UTF-8, title, size, control-char, and secret checks.
 *    - loadFixedAssets: Bounded reads with SHA-256 instruction/knowledge versions.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { CONTRACT_VERSIONS } from '../contracts/versions.js';
import { AppError } from '../platform/errors/app-error.js';

export type AssetPaths = { instructions: string | URL; knowledge: string | URL };
export type FixedAssets = Readonly<{
  instructions: string;
  knowledge: string;
  instructionVersion: string;
  knowledgeContentHash: string;
  graphSchemaVersion: string;
}>;
const MAX_ASSET_BYTES = 16_384;

function decodeAsset(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('invalid_fixed_asset');
  }
}

function hasDisallowedControlChars(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      return true;
    }
  }
  return false;
}

export function validateAsset(bytes: Uint8Array, kind: 'instructions' | 'knowledge'): string {
  const text = decodeAsset(bytes);
  const title = kind === 'knowledge' ? '# Aurvin product knowledge' : '# Aurvin system instructions';
  const release = kind === 'knowledge' ? 'phase1.v1' : 'phase1.v2';
  if (
    (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
    bytes.length === 0 || bytes.length > MAX_ASSET_BYTES ||
    !(text.startsWith(`${title}\n\nRelease: ${release}\n`) ||
      text.startsWith(`${title}\r\n\r\nRelease: ${release}\r\n`)) ||
    hasDisallowedControlChars(text) ||
    /sk-or-v1-|mongodb(?:\+srv)?:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{16,}|(?:OPENROUTER_API_KEY|MONGODB_URI)\s*[:=]/iu.test(text)) {
    throw new Error('invalid_fixed_asset');
  }
  return text;
}

async function readBounded(path: string | URL): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_ASSET_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}

export async function loadFixedAssets(paths: AssetPaths): Promise<FixedAssets> {
  try {
    const [instructionBytes, knowledgeBytes] = await Promise.all([
      readBounded(paths.instructions), readBounded(paths.knowledge),
    ]);
    return Object.freeze({
      instructions: validateAsset(instructionBytes, 'instructions'),
      knowledge: validateAsset(knowledgeBytes, 'knowledge'),
      instructionVersion: createHash('sha256').update(instructionBytes).digest('hex'),
      knowledgeContentHash: createHash('sha256').update(knowledgeBytes).digest('hex'),
      graphSchemaVersion: CONTRACT_VERSIONS.graphSchema,
    });
  } catch {
    throw new AppError('CONFIGURATION_ERROR',
      'Required Aurvin instructions or knowledge are unavailable or invalid.');
  }
}
