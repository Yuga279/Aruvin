import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AppService } from '../../src/app.service.js';
import { configureApplication } from '../../src/main.js';
import {
  GOOGLE_CALENDAR_CONNECTIONS,
  GOOGLE_CALENDAR_OAUTH,
} from '../../src/plugins/google-calendar/controller.js';
import { loadBootstrapConfig } from '../../src/platform/config/bootstrap-config.js';
import { AURVIN_CONFIG } from '../../src/platform/tokens.js';
import { assemblyFixture } from './admin-config-fixture.js';
import { assembledCalendarApp } from './calendar-fixture.js';

it('adds Calendar without another store, runtime or close owner', async () => {
  const f = assemblyFixture();
  const service = await AppService.create(f.bootstrap, f.ports);
  expect(f.open).toHaveBeenCalledTimes(1);
  expect(f.runtime).toHaveBeenCalledTimes(1);
  expect(service.calendarFor('aurvin-dev-user').connections).toBeDefined();
  expect(service.calendarFor('aurvin-dev-user').oauth).toBeDefined();
  expect((await service.calendarFor('aurvin-dev-user').connections.status()).state).toBe('disabled');
  expect(f.fetcher).not.toHaveBeenCalled();
  await service.operations.shutdown();
  expect(f.close).toHaveBeenCalledTimes(1);
});

it('keeps blank MongoDB diagnostic and never probes Calendar', async () => {
  const f = assemblyFixture();
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    MONGODB_URI: '',
  });
  const service = await AppService.create(bootstrap, f.ports);
  expect(f.open).not.toHaveBeenCalled();
  expect(f.runtime).not.toHaveBeenCalled();
  expect(f.fetcher).not.toHaveBeenCalled();
  expect((await service.calendarFor('aurvin-dev-user').connections.status()).state).toBe('disabled');
  expect(service.currentConfig.current()?.calendar?.enabled).not.toBe(true);
  expect(await service.operations.shutdown()).toEqual({ safe: true });
  expect(f.close).not.toHaveBeenCalled();
});

it('does not probe Google when the master key or policy is missing', async () => {
  const f = assemblyFixture();
  const bootstrap = loadBootstrapConfig({
    NODE_ENV: 'development',
    FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
    PERSISTENCE_PROFILE: 'native-mongodb',
    MONGODB_URI: 'fixture-injected-only',
    MONGODB_DB_NAME: 'aurvin_fixture',
    AURVIN_GOOGLE_CALENDAR_CLIENT_ID: 'fixture-client',
    AURVIN_GOOGLE_CALENDAR_CLIENT_SECRET: 'fixture-secret',
    AURVIN_GOOGLE_CALENDAR_REDIRECT_URI:
      'http://127.0.0.1:3000/api/plugins/google-calendar/oauth/callback',
    AURVIN_GOOGLE_CALENDAR_TARGET_ID: 'owned-a',
    AURVIN_GOOGLE_CALENDAR_PROCESSING_POLICY_ID: 'fixture-policy',
  });
  const service = await AppService.create(bootstrap, f.ports);
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(service.calendarFor('aurvin-dev-user').connections.isConfigured()).toBe(false);
  expect((await service.calendarFor('aurvin-dev-user').connections.status()).state).toBe('disabled');
  expect(service.currentConfig.current()?.calendar?.enabled).toBe(false);
  await service.operations.shutdown();
});

it('injects the same Calendar instances into the Nest module', async () => {
  const f = assemblyFixture();
  const service = await AppService.create(f.bootstrap, f.ports);
  const previous = { NODE_ENV: process.env.NODE_ENV, FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(f.bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    const app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false, logger: false,
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    try {
      expect(app.get(GOOGLE_CALENDAR_CONNECTIONS)).toBeDefined();
      expect(app.get(GOOGLE_CALENDAR_OAUTH)).toBeDefined();
    } finally {
      await app.close();
    }
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
    await service.operations.shutdown();
  }
});

it('shares the v2 connection and exposes no-target bootstrap to HTTP assembly', async () => {
  const h = await assembledCalendarApp();
  try {
    expect(h.bootstrap.calendar).toBeDefined();
    expect(h.bootstrap.calendar?.setup.oauth?.targetCalendarId).toBeUndefined();
    const raw = await h.cal.p.calendarConnectionsV2.get('aurvin-dev-user');
    const status = await h.service.calendarFor('aurvin-dev-user').connections.statusV2();
    expect(status.connectionRevision).toBe(raw?.connectionRevision);
    expect(status.primaryCalendarId).toBe('owned');
    await h.cal.setDefault('team@example.test');
    expect((await h.service.calendarFor('aurvin-dev-user').connections.statusV2()).defaultSetting)
      .toMatchObject({ defaultCalendarId: 'team@example.test' });
    expect(h.f.ports.open).toHaveBeenCalledTimes(1);
    expect(h.f.ports.runtime).toHaveBeenCalledTimes(1);
  } finally { await h.dispose(); }
});
