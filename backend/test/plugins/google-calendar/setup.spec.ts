import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CALENDAR_SCOPES } from '../../../src/contracts/calendar-policy.js';
import { calendarStatusV2ResponseSchema } from '../../../src/contracts/calendar-wire.js';
import { GoogleCalendarOAuthService } from '../../../src/plugins/google-calendar/oauth.js';
import { configureGoogleCalendarHttp } from '../../../src/plugins/google-calendar/controller-http.js';
import { GoogleCalendarModule } from '../../../src/plugins/google-calendar/module.js';
import { connectionFixture } from './connection-fixtures.js';
import { principal } from '../../assembly/auth-principal-fixture.js';

async function setupFixture(init: { configured?: boolean; enabled?: boolean } = {}) {
  const base = connectionFixture(init);
  const putState = vi.spyOn(base.store, 'putState');
  const logs: string[] = [];
  const publicErrors: unknown[] = [];
  const log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(log);
  vi.spyOn(console, 'info').mockImplementation(log);
  vi.spyOn(console, 'warn').mockImplementation(log);
  base.client.exchange.mockImplementation(async () => ({
    accessToken: 'fixture-access',
    refreshToken: 'fixture-refresh',
    idToken: 'fixture-id-token',
    expiresAt: new Date(base.clock.now() + 3_600_000).toISOString(),
    scopes: [...CALENDAR_SCOPES],
  }));
  const oauth = new GoogleCalendarOAuthService({
    connections: base.service,
    store: base.store,
    cipher: base.cipher,
    options: base.options,
    client: base.client as never,
    googleIdentity: { verify: vi.fn(async () => ({ subject: 'fixture-sub', email: 'fixture@example.invalid' })) },
    now: () => base.clock.now(),
  });
  const moduleRef = await Test.createTestingModule({
    imports: [GoogleCalendarModule.register({
      connections: () => base.service, oauth: () => oauth,
      principal: () => principal('u1'), frontendOrigin: base.options.frontendOrigin,
    })],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  app.setGlobalPrefix('api');
  configureGoogleCalendarHttp(app, {
    frontendOrigin: base.options.frontendOrigin,
    backendOrigin: base.options.backendOrigin,
    redirectUri: base.options.oauth?.redirectUri
      ?? 'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    now: () => base.clock.now(),
  });
  await app.init();
  const completeFixtureFlow = async () => {
    const start = await request(app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/start')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .set('X-Aurvin-Calendar-CSRF', '1').send({}).expect(200);
    const rawState = new URL(start.body.authorizationUrl).searchParams.get('state')!;
    const setCookie = String(start.headers['set-cookie'] ?? '');
    const browserCookie = /aurvin_gcal_oauth=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const records = [...base.store.states.values()];
    const record = records[0]!;
    const verifier = base.cipher.openVerifier({
      userId: record.userId, stateHash: record.stateHash, browserHash: record.browserHash,
      oidcNonceHash: record.oidcNonceHash, redirectUri: record.redirectUri,
    }, record.encryptedVerifier);
    const page = await request(app.getHttpServer())
      .get(`/api/plugins/google-calendar/oauth/callback?state=${rawState}&code=fixture-code`)
      .set('Host', '127.0.0.1:3000')
      .set('Cookie', `aurvin_gcal_oauth=${browserCookie}`)
      .expect(200);
    expect(page.text).toContain('/api/plugins/google-calendar/oauth/complete');
    const complete = await request(app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/complete')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .set('X-Aurvin-Calendar-CSRF', '1')
      .set('Cookie', `aurvin_gcal_oauth=${browserCookie}`)
      .send({ rawQuery: `state=${rawState}&code=fixture-code` })
      .expect(200);
    const status = calendarStatusV2ResponseSchema.parse(
      (await request(app.getHttpServer()).get('/api/plugins/google-calendar/status')
        .set('Host', '127.0.0.1:3000').expect(200)).body,
    );
    return {
      status,
      location: `http://127.0.0.1:5173/?plugin=google-calendar&oauth=${complete.body.outcome}`,
      verifier, rawState, browserCookie,
    };
  };
  return {
    app, putState, network: base.network, base, oauth, logs, publicErrors,
    invalidations: base.invalidations, completeFixtureFlow, restore: () => consoleSpy.mockRestore(),
  };
}

it('setup module rejects hostile origins before OAuth state or provider work', async () => {
  const f = await setupFixture();
  try {
    await request(f.app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/start')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.example')
      .set('X-Aurvin-Calendar-CSRF', '1').send({}).expect(403);
    expect(f.putState).not.toHaveBeenCalled();
    expect(f.network).not.toHaveBeenCalled();
    const status = await request(f.app.getHttpServer())
      .get('/api/plugins/google-calendar/status').set('Host', '127.0.0.1:3000').expect(200);
    expect(calendarStatusV2ResponseSchema.parse(status.body).state).toBe('disabled');
    expect(status.headers['cache-control']).toBe('no-store');
  } finally { await f.app.close(); }
});

it('status is no-store and mutations require csrf and origin', async () => {
  const f = await setupFixture();
  try {
    const status = await request(f.app.getHttpServer())
      .get('/api/plugins/google-calendar/status').set('Host', '127.0.0.1:3000').expect(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(status.headers['x-content-type-options']).toBe('nosniff');
    await request(f.app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .send({ enabled: true }).expect(403);
    await request(f.app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/start')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .set('X-Aurvin-Calendar-CSRF', '1').send({}).expect(503);
    await request(f.app.getHttpServer())
      .options('/api/plugins/google-calendar/status')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:5173')
      .expect(204);
  } finally { await f.app.close(); }
});

it('callback rejects a hostile origin without redirecting', async () => {
  const f = await setupFixture();
  try {
    const response = await request(f.app.getHttpServer())
      .get('/api/plugins/google-calendar/oauth/callback?state=abc')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.example')
      .expect(403);
    expect(response.headers.location).toBeUndefined();
  } finally { await f.app.close(); }
});

it('fixture flow never claims a real connection or leaks backend secrets', async () => {
  const f = await setupFixture({ configured: true, enabled: true });
  try {
    const output = await f.completeFixtureFlow();
    expect(output.status.state).toBe('degraded');
    expect(new URL(output.location).searchParams.get('oauth')).toBe('fixture');
    const publicText = JSON.stringify({ status: output.status,
      location: output.location, errors: f.publicErrors, logs: f.logs,
      invalidations: f.invalidations });
    for (const secret of ['fixture-client-secret', 'fixture-code', 'fixture-access',
      'fixture-refresh', output.verifier, output.rawState, output.browserCookie]) {
      expect(publicText).not.toContain(secret);
    }
    expect(publicText).not.toContain('encryptedVerifier');
    expect(publicText).not.toContain('credentials');
    const unsafePublicText = `${publicText}\nfixture-refresh`;
    expect(() => expect(unsafePublicText).not.toContain('fixture-refresh')).toThrow();
  } finally {
    f.restore();
    await f.app.close();
  }
});
