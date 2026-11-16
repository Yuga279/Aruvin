import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { admittedAccount, authFixture, SESSION_COOKIE } from '../auth/fixtures.js';
import { assemblyFixture } from './admin-config-fixture.js';

const FRONTEND = 'http://127.0.0.1:5173';
const KEY = Buffer.alloc(32, 7).toString('base64');

function calendarBootstrap() {
  return loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: FRONTEND,
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-injected-only',
    MONGODB_DB_NAME: 'aurvin_fixture',
    AURVIN_CONFIG_ENCRYPTION_KEY: KEY,
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'owned-a',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
  });
}

async function boot() {
  const f = assemblyFixture();
  const bootstrap = calendarBootstrap();
  const auth = await authFixture(admittedAccount());
  Object.assign(f.bundle, { users: auth.users });
  const service = await AppService.create(bootstrap, { ...f.ports, authProvider: () => auth.provider });
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = FRONTEND;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false, logger: false,
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return { f, service, app };
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

it('registers guarded Calendar setup routes on the full application', async () => {
  const started = await boot();
  const { f, app } = started;
  const putState = vi.spyOn(f.bundle.calendarConnections, 'putState');
  try {
    await request(app.getHttpServer())
      .get('/api/plugins/google-calendar/status')
      .set('Host', '127.0.0.1:3000').set('Cookie', SESSION_COOKIE).expect(200);
    await request(app.getHttpServer())
      .patch('/api/plugins/google-calendar/settings')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND).set('Cookie', SESSION_COOKIE)
      .set('X-Aurvin-Calendar-CSRF', '1').send({ enabled: true }).expect(200);
    await request(app.getHttpServer())
      .post('/api/plugins/google-calendar/oauth/start')
      .set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.invalid')
      .set('X-Aurvin-Calendar-CSRF', '1').send({}).expect(403);
    expect(putState).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .options('/api/plugins/google-calendar/settings')
      .set('Host', '127.0.0.1:3000').set('Origin', FRONTEND).expect(204);
    const callback = await request(app.getHttpServer())
      .get('/api/plugins/google-calendar/oauth/callback?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&error=access_denied')
      .set('Host', '127.0.0.1:3000').redirects(0);
    expect(callback.status).toBe(200);
    expect(callback.text).toContain('/api/plugins/google-calendar/oauth/complete');
    expect(putState).not.toHaveBeenCalled();
  } finally {
    await app.close();
    await started.service.operations.shutdown();
  }
});
