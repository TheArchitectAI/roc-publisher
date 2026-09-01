import compression from 'compression';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { registerScannerProbeMiddleware } from './not-found/not-found.adapter';

type RegisterMcp = (app: INestApplication) => Promise<void> | void;

type ConfigureBackendAppOptions = {
  registerMcp?: RegisterMcp;
};

export async function configureBackendApp(
  app: INestApplication,
  options: ConfigureBackendAppOptions = {}
) {
  registerScannerProbeMiddleware(app);

  if (options.registerMcp) {
    await options.registerMcp(app);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );

  app.use(['/copilot/*', '/posts'], (req: any, res: any, next: any) => {
    json({ limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());
  app.use(compression());
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);
}
