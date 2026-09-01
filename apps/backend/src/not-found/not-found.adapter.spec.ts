import {
  Controller,
  Get,
  Injectable,
  INestApplication,
  Module,
  NotFoundException,
  OnApplicationBootstrap,
  RequestMethod,
  VERSION_NEUTRAL,
  VersioningType,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { configureBackendApp } from '../bootstrap';
import { initWithAdapterNotFoundHandler } from './not-found.adapter';

const request: any = require('supertest');

@Controller('health')
class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Controller({
  path: 'real',
  version: VERSION_NEUTRAL,
})
class RealRouteController {
  @Get()
  getRealRoute() {
    return { ok: true };
  }

  @Get('throws-not-found')
  throwsNotFound() {
    throw new NotFoundException('Missing real route resource');
  }
}

@Controller({
  path: 'versioned',
  version: '1',
})
class VersionedRouteController {
  @Get()
  getVersionedRoute() {
    return { version: '1' };
  }
}

@Injectable()
class LateWebhookRegistrar implements OnApplicationBootstrap {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onApplicationBootstrap() {
    this.httpAdapterHost.httpAdapter
      .getInstance()
      .post('/webhooks/late', (_req: unknown, res: any) =>
        res.status(202).json({ received: true })
      );
  }
}

@Module({
  controllers: [
    HealthController,
    RealRouteController,
    VersionedRouteController,
  ],
  providers: [LateWebhookRegistrar],
})
class TestHttpModule {}

describe('adapter-level not-found handler', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestHttpModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: VERSION_NEUTRAL,
    });

    await configureBackendApp(app, { registerMcp: async () => undefined });
    await initWithAdapterNotFoundHandler(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns Nest-shaped 404 bodies for unknown GET, POST, and nested paths', async () => {
    await request(app.getHttpServer())
      .get('/unknown-route?source=test')
      .expect(404)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({
          message: 'Cannot GET /unknown-route?source=test',
          error: 'Not Found',
          statusCode: 404,
        });
      });

    await request(app.getHttpServer())
      .post('/unknown-route')
      .send({ ok: true })
      .expect(404)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({
          message: 'Cannot POST /unknown-route',
          error: 'Not Found',
          statusCode: 404,
        });
      });

    await request(app.getHttpServer())
      .get('/a/b')
      .expect(404)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({
          message: 'Cannot GET /a/b',
          error: 'Not Found',
          statusCode: 404,
        });
      });
  });

  it('keeps real, health, swagger, versioned, and late adapter routes reachable', async () => {
    await request(app.getHttpServer())
      .get('/api/real')
      .expect(200)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({ ok: true });
      });

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({ status: 'ok' });
      });

    await request(app.getHttpServer())
      .get('/docs')
      .expect(200)
      .expect('Content-Type', /html/);

    await request(app.getHttpServer())
      .get('/api/v1/versioned')
      .expect(200)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({ version: '1' });
      });

    await request(app.getHttpServer())
      .post('/webhooks/late')
      .send({ event: 'created' })
      .expect(202)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({ received: true });
      });
  });

  it('keeps scanner short-circuit and matches route-thrown NotFoundException body shape', async () => {
    await request(app.getHttpServer())
      .get('/.env')
      .expect(404)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({ error: 'Not found' });
      });

    const routeThrown = await request(app.getHttpServer())
      .get('/api/real/throws-not-found')
      .expect(404);

    const adapterMiss = await request(app.getHttpServer())
      .get('/unknown-route?source=parity')
      .expect(404);

    expect(routeThrown.body).toEqual({
      message: 'Missing real route resource',
      error: 'Not Found',
      statusCode: 404,
    });
    expect(adapterMiss.body).toEqual({
      ...routeThrown.body,
      message: 'Cannot GET /unknown-route?source=parity',
    });
    expect(Object.keys(adapterMiss.body).sort()).toEqual(
      Object.keys(routeThrown.body).sort()
    );
  });

  it('keeps adapter routes mounted after initWithAdapterNotFoundHandler() unreachable by design', async () => {
    app
      .getHttpAdapter()
      .getInstance()
      .get('/webhooks/too-late', (_req: unknown, res: any) =>
        res.status(202).json({ received: true })
      );

    await request(app.getHttpServer())
      .get('/webhooks/too-late')
      .expect(404)
      .expect(({ body }: { body: any }) => {
        expect(body).toEqual({
          message: 'Cannot GET /webhooks/too-late',
          error: 'Not Found',
          statusCode: 404,
        });
      });
  });
});
