/**
 * Frozen Calendar capability and price evidence for the model boundary.
 *
 * Frozen prices pin known models. `catalogue.ts` still admits any other
 * configured model whose live catalogue entry lists `tools` and citeable
 * prompt/completion rates. A rate Aurvin cannot parse is unused, never zero.
 *
 * - `CALENDAR_PRICE_TABLE` maps a model id to the `CalendarTokenPricing` that
 *   `catalogue.ts` compares, exactly, against the catalogue's listed prices.
 * - `calendarEvidenceFor` returns that frozen pin, or `null` so the catalogue
 *   observation itself becomes the cited rate.
 *
 * Fail-safe: `verifiedCalendar` returns `undefined` whenever the catalogue and
 * this table disagree, so a provider price change or a removed `tools`
 * parameter disables the plugin instead of mis-costing it.
 */

import type { CalendarTokenPricing } from '../contracts/calendar-accounting.js';
import type { CalendarCatalogueEvidence } from './catalogue.js';

/** Stable id of the catalogue observation the frozen table was taken from. */
export const CALENDAR_EVIDENCE_VERSION = 'openrouter-catalogue-2026-10-22';

/**
 * Aurvin's own route label for the frozen model.
 *
 * The catalogue entry for `openai/gpt-6-luna` carries a `top_provider` block
 * with no `provider_name`, so there is no provider name to quote. The label
 * below names the route Aurvin actually uses - OpenRouter's default route for
 * the OpenAI-authored model - and is deliberately a documented constant rather
 * than a value derived from a model id. `verifiedCalendar` never compares it
 * against the catalogue; it only has to be stable and honest.
 */
export const CALENDAR_DEFAULT_PROVIDER_ROUTE = 'openrouter-default/openai';

/**
 * Catalogue admission does not require `parallel_tool_calls`.
 *
 * The Calendar dispatch body adds the parameter only when this flag is true
 * (`calendar-policy.ts`). `require_parameters: true` would otherwise reject
 * models that omit it from `supported_parameters`. Aurvin still enforces one
 * call per decision server-side.
 */
export const CALENDAR_PARALLEL_TOOL_CALLS_PARAMETER = false;

/**
 * Aurvin does not send `response_format` or native strict structured output
 * for Calendar tool calls.
 *
 * The frozen Calendar tool schemas contain optional properties that need not
 * satisfy a provider's strict-mode subset, and the goal states that
 * provider-native strict modes may reduce failures but never replace server
 * validation. Aurvin relies on native `tools` plus its own server-side
 * validation, so requiring `structured_outputs` would be a stricter admission
 * gate than Aurvin actually needs and would reject models that work.
 */
export const CALENDAR_NATIVE_STRICT = false;

/**
 * Frozen price evidence per model id, read from the OpenRouter catalogue.
 *
 * Each entry is the `CalendarTokenPricing` that `verifiedCalendar` compares
 * against the catalogue's listed `pricing.prompt` / `pricing.completion`
 * (and `pricing.request` when the catalogue lists one). Nothing here is
 * fetched, interpolated, or inferred from a model id at runtime.
 *
 * `openai/gpt-6-luna` (catalogue observation 2026-10-22):
 * - `context_length` 1050000, `top_provider.max_completion_tokens` 128000.
 * - `supported_parameters` includes `tools`, `structured_outputs` and
 *   `max_tokens`; it does not list `parallel_tool_calls`. Aurvin omits that
 *   request field for this model.
 * - `pricing.prompt` "0.0000001", `pricing.completion` "0.0000005".
 * - The catalogue lists no per-request charge, so `requestUsd` is "0". That is
 *   the catalogue's own statement about this model, not an invented rate.
 *
 * ponytail: the frozen rates are the catalogue's base tier, which applies while
 * a prompt stays under the catalogue's 272000-token override threshold.
 * Aurvin's context ceiling (16384 by default, 30000 as configured) is far
 * below that threshold, so the base tier is the applicable one; a context
 * ceiling above 272000 tokens would need a tier-aware reservation before this
 * evidence is reused.
 */
export const CALENDAR_PRICE_TABLE: Readonly<Record<string, CalendarTokenPricing>> = Object.freeze({
  'openai/gpt-6-luna': Object.freeze({
    version: CALENDAR_EVIDENCE_VERSION,
    source: 'OpenRouter GET /api/v1/models catalogue entry openai/gpt-6-luna, observed 2026-10-22',
    observedAt: '2026-10-22T00:00:00.000Z',
    modelId: 'openai/gpt-6-luna',
    providerRoute: CALENDAR_DEFAULT_PROVIDER_ROUTE,
    promptUsdPerToken: '0.0000001',
    completionUsdPerToken: '0.0000005',
    requestUsd: '0',
  }),
});

/**
 * Frozen Calendar capability evidence for a model id.
 *
 * @param modelId the configured OpenRouter model id.
 * @returns frozen price pin for a known model, or `null` to use live catalogue rates.
 */
export function calendarEvidenceFor(modelId: string): CalendarCatalogueEvidence | null {
  if (!Object.hasOwn(CALENDAR_PRICE_TABLE, modelId)) return null;
  const pricing = CALENDAR_PRICE_TABLE[modelId];
  return {
    pricing,
    nativeStrict: CALENDAR_NATIVE_STRICT,
    parallelToolCallsParameter: CALENDAR_PARALLEL_TOOL_CALLS_PARAMETER,
  };
}
