import type { CalendarRuntimeDependencies } from '../../chat-runtime/calendar-ports.js';
import { parseCalendarSetupOptions, type CalendarSetupOptions }
  from '../../plugins/google-calendar/options.js';
import { sourcePermissionSchema } from '../../contracts/calendar-sources.js';
import { AppError } from '../errors/app-error.js';

export const CALENDAR_BOOTSTRAP_ENV_NAMES = [
  'AURVIN_GOOGLE_CALENDAR_CLIENT_ID',
  'AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET',
  'AURVIN_GOOGLE_CALENDAR_REDIRECT_URI',
  'AURVIN_GOOGLE_CALENDAR_TARGET_ID',
  'AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID',
  'AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED',
  'AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION',
  'AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED',
  'AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT',
  'AURVIN_GOOGLE_CALENDAR_TIME_ZONE',
] as const;

export type CalendarBootstrap = {
  setup: CalendarSetupOptions;
  permission: CalendarRuntimeDependencies['permission'];
  policyDeadlines: readonly number[];
  trustedTimeZone: string;
};

function invalid(): never {
  throw new AppError('CONFIGURATION_ERROR', 'Calendar setup configuration is invalid.', false);
}

export function loadCalendarBootstrap(
  env: Record<string, string | undefined>, frontendOrigin: string, port: number,
): CalendarBootstrap | null {
  if (!CALENDAR_BOOTSTRAP_ENV_NAMES.some(name => (env[name] ?? '') !== '')) return null;
  const text = (name: typeof CALENDAR_BOOTSTRAP_ENV_NAMES[number]) => env[name] ?? '';
  const flag = (name: typeof CALENDAR_BOOTSTRAP_ENV_NAMES[number]) => {
    const value = text(name);
    if (value !== '' && value !== 'false' && value !== 'true') invalid();
    return value === 'true';
  };
  let frontend: URL;
  try { frontend = new URL(frontendOrigin); } catch { invalid(); }
  if (frontend.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(frontend.hostname)
    || frontend.origin !== frontendOrigin) invalid();
  const backendOrigin = `http://${frontend.hostname}:${port}`;
  const deadline = text('AURVIN_GOOGLE_CALENDAR_POLICY_DEADLINE_AT');
  if (deadline !== '' && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(deadline)
    || !Number.isFinite(Date.parse(deadline)))) invalid();
  const policyDeadlines = deadline === '' ? [] : [Date.parse(deadline)];
  const content = text('AURVIN_GOOGLE_CALENDAR_CONTENT_PERMISSION') || 'volatile';
  if (content !== 'volatile' && content !== 'retained') invalid();
  const policyId = text('AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID');
  const minimalEvidenceAllowed = flag('AURVIN_GOOGLE_CALENDAR_MINIMAL_EVIDENCE_ALLOWED');
  const approved = flag('AURVIN_GOOGLE_CALENDAR_POLICY_APPROVED');
  const trustedTimeZone = text('AURVIN_GOOGLE_CALENDAR_TIME_ZONE') || 'Etc/UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: trustedTimeZone }); } catch { invalid(); }
  let permission: CalendarRuntimeDependencies['permission'];
  try {
    permission = sourcePermissionSchema.parse({
      content, minimalEvidenceAllowed, policyId: policyId || 'calendar-unconfigured',
    });
  } catch { invalid(); }
  let setup: CalendarSetupOptions;
  try { setup = parseCalendarSetupOptions({
    initial: { enabled: false, processingPolicyId: policyId || null },
    oauth: {
      clientId: text('AURVIN_GOOGLE_CALENDAR_CLIENT_ID'),
      clientSecret: text('AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET'),
      redirectUri: text('AURVIN_GOOGLE_CALENDAR_REDIRECT_URI'),
    },
    frontendOrigin, backendOrigin, evidence: 'google',
    realDataPolicyApproved: approved && policyId !== '' && minimalEvidenceAllowed
      && policyDeadlines.length > 0,
  }); } catch { invalid(); }
  return {
    setup, policyDeadlines, trustedTimeZone, permission,
  };
}
