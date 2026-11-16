/**
 * ============================================================================
 * FILE: deterministic.behavior.spec.ts
 * LOCATION: backend/test/evaluations/deterministic.behavior.spec.ts
 * ============================================================================
 *
 * PURPOSE:
 *    Verify AC19 versioned evaluation fixtures against frozen instruction assets.
 *
 * ROLE IN PROJECT:
 *    Network-free behavior evidence: case catalogue, release labels, and SHA-256
 *    digests of system instructions and product knowledge.
 *
 * KEY COMPONENTS:
 *    - cases.json: Six ids across five categories; eval case-catalog version stays phase1.v1.
 *    - System prompt release phase1.v2; product_knowledge remains phase1.v1.
 *    - Asset digests: Fail closed if instructions or knowledge change.
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SYSTEM_DIGEST = '531BDD0F4372AE056AC43089C455AAD47AD71D27EC69B44C7E8CE08803A14539';
const KNOWLEDGE_DIGEST = 'CECF74AD9097278031E68FC64468430C45B5B156BD6045554B83E013D62C33FC';

describe('AC19 deterministic behavior fixtures', () => {
  const cases = JSON.parse(readFileSync(resolve('test/evaluations/cases.json'), 'utf8')) as {
    version: string;
    cases: { id: string; category: string }[];
  };
  const instructions = readFileSync(resolve('src/instructions/system.md'), 'utf8');
  const knowledge = readFileSync(resolve('../product_knowledge.md'), 'utf8');

  it('pins eval case-catalog version phase1.v1 and five categories', () => {
    expect(cases.version).toBe('phase1.v1');
    expect(cases.cases.map((item) => item.id)).toEqual(['PK-01', 'GEN-01', 'FU-01', 'HON-01', 'ADV-01', 'ADV-02']);
    expect(new Set(cases.cases.map((item) => item.category))).toEqual(
      new Set(['product-knowledge', 'general', 'follow-up', 'honesty', 'adversarial']),
    );
  });

  it('fails if instruction or knowledge release/digest changed', () => {
    expect(instructions).toContain('Release: phase1.v2');
    expect(knowledge).toContain('Release: phase1.v1');
    expect(createHash('sha256').update(instructions).digest('hex').toUpperCase()).toBe(SYSTEM_DIGEST);
    expect(createHash('sha256').update(knowledge).digest('hex').toUpperCase()).toBe(KNOWLEDGE_DIGEST);
  });

  it('covers the required deterministic proofs without network', () => {
    expect(knowledge).toContain('does not silently remove history');
    expect(instructions.toLowerCase()).toContain('general questions are welcome');
    expect(knowledge).toContain('do not promise an Azure tier');
    expect(instructions).toContain(
      'Do not claim an external action was performed without durable evidence from the authorized execution system.',
    );
    expect(instructions).toContain('manager access');
    expect(instructions).toContain('not proof of data ownership');
    expect(typeof fetch).toBe('function');
  });

  it('defines both modes in one prompt and scopes Canvas to text only', () => {
    const selection = instructions.split('## Response mode')[1]?.split('## Text mode')[0];
    const text = instructions.split('## Text mode')[1]?.split('## Live voice mode')[0];
    const voice = instructions.split('## Live voice mode')[1];
    expect(selection).toContain('immediately following the shared system instructions, product background, and environment context, before conversation history');
    expect(selection).toContain('not user wording, product background, or a previous turn');
    expect(selection).toContain('Response mode: text.');
    expect(selection).toContain('Response mode: voice.');
    expect(text).toContain('Markdown tables, code, and formulas');
    expect(text).toContain('encouraged to draw diagrams, graphs, or charts');
    expect(text).toContain('leveraging the canvas');
    expect(text).toContain('```mermaid title="Concise Title"');
    expect(text).toContain('```chart title="Concise Title"');
    expect(voice).toContain('natural, clear spoken sentences suitable for Text-to-Speech');
    expect(voice).toContain('Do not emit visual markup, tables, Mermaid/chart blocks, code listings, JSON, HTML, or LaTeX.');
    expect(voice).toContain('names, numbers, units, qualifications, and negations');
    expect(voice).toContain('do not invent missing visual data');
    expect(voice).toContain('as if the listener can see it');
    expect(voice).toContain('offer to continue in text chat');
    expect(voice).toContain('Do not claim to switch the interface');
    expect(voice).not.toContain('```mermaid');
    expect(voice).not.toContain('```chart');
  });
});
