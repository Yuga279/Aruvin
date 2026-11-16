import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../../src/app.module.js';
import { AppService } from '../../../src/app.service.js';
import { configureApplication } from '../../../src/main.js';
import { AURVIN_CONFIG } from '../../../src/platform/tokens.js';
import { assemblyFixture } from '../../assembly/admin-config-fixture.js';
import { assembledCalendarApp } from '../../assembly/calendar-fixture.js';
import { admittedAccount, authFixture } from '../../auth/fixtures.js';

export const FRONTEND_ORIGIN = 'http://127.0.0.1:5173';
export const BACKEND_ORIGIN = 'http://127.0.0.1:3000';
export const BACKEND_HOST = new URL(BACKEND_ORIGIN).host;
export const BLANK_FRONTEND_ORIGIN = 'http://localhost:5173';

export type AssembledCalendar = {
  app: NestExpressApplication;
  backendHost: string;
  frontendOrigin: string;
  modelWires: string[];
  modelBodies: Array<Record<string, unknown>>;
  effects: Array<{ kind: string; eventId: string | null }>;
  googleWrites(): number;
  port(): number;
  dispose(): Promise<void>;
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function boot(bootstrap: unknown, service: AppService): Promise<NestExpressApplication> {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
  };
  process.env.NODE_ENV = 'development';
  process.env.FRONTEND_ORIGIN = FRONTEND_ORIGIN;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AURVIN_CONFIG).useValue(bootstrap)
      .overrideProvider(AppService).useValue(service).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false, logger: false,
    });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    return app;
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.FRONTEND_ORIGIN === undefined) delete process.env.FRONTEND_ORIGIN;
    else process.env.FRONTEND_ORIGIN = previous.FRONTEND_ORIGIN;
  }
}

/**
 * The committed P8 Calendar assembly fixture with the committed Nest HTTP layer.
 *
 * The P8 worker owns `assembledCalendarApp`; this binding adds only the HTTP
 * application the committed P8 flow spec already uses. It never constructs a
 * second `AppService`, a second persistence owner or a second runtime.
 */
export async function openAssembledCalendar(): Promise<AssembledCalendar> {
  const assembled = await assembledCalendarApp();
  const app = await boot(assembled.bootstrap, assembled.service);
  const fetcher = assembled.fetcher;
  const calendar: AssembledCalendar = {
    app,
    backendHost: BACKEND_HOST,
    frontendOrigin: FRONTEND_ORIGIN,
    modelWires: assembled.cal.modelWires,
    modelBodies: assembled.cal.modelBodies,
    effects: assembled.cal.effects,
    googleWrites() {
      return fetcher.mock.calls.filter((call) =>
        requestUrl(call[0]).includes('/calendar/v3/calendars/')
        && String(call[1]?.method ?? 'GET') === 'POST').length;
    },
    port() {
      const address = app.getHttpServer().address();
      return typeof address === 'object' && address ? address.port : 0;
    },
    async dispose() {
      await app.close().catch(() => undefined);
      await assembled.dispose();
    },
  };
  if (!calendar.app.getHttpServer || !calendar.modelWires || !calendar.dispose) {
    throw new Error('P8_FIXTURE_SHAPE_MISSING');
  }
  return calendar;
}

/**
 * The committed P8 blank assembly fixture with the same HTTP layer. It carries
 * no Calendar configuration, so it proves the default-off boundary over HTTP
 * without inventing a new composition.
 */
export async function openBlankAssembledCalendar(): Promise<AssembledCalendar> {
  const fixture = assemblyFixture();
  const auth = await authFixture(admittedAccount());
  Object.assign(fixture.bundle, { users: auth.users });
  const service = await AppService.create(fixture.bootstrap, {
    ...fixture.ports, authProvider: () => auth.provider,
  });
  const app = await boot(fixture.bootstrap, service);
  const frontendOrigin = service.config.frontendOrigin;
  const backendHost = `${new URL(frontendOrigin).hostname}:${service.config.port}`;
  return {
    app,
    backendHost,
    frontendOrigin,
    modelWires: [],
    modelBodies: [],
    effects: [],
    googleWrites() {
      return 0;
    },
    port() {
      const address = app.getHttpServer().address();
      return typeof address === 'object' && address ? address.port : 0;
    },
    async dispose() {
      await app.close().catch(() => undefined);
      await service.operations.shutdown();
    },
  };
}
