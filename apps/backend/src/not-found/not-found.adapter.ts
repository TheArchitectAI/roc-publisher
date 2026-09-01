import {
  ArgumentsHost,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

type ExpressApplication = {
  use: (...args: any[]) => unknown;
};

type NotFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => void;

type AdapterWithNotFoundHandler = ReturnType<
  INestApplication['getHttpAdapter']
> & {
  getInstance?: () => ExpressApplication;
  setNotFoundHandler?: (handler: NotFoundHandler, prefix?: string) => unknown;
};

export function isScannerProbePath(path: string) {
  const lowerPath = path.toLowerCase();

  return (
    lowerPath.endsWith('.php') ||
    lowerPath.includes('/wp-') ||
    lowerPath.includes('/wordpress') ||
    lowerPath.includes('/phpmyadmin') ||
    lowerPath.includes('/vendor/phpunit') ||
    lowerPath.includes('/.env')
  );
}

export function registerScannerProbeMiddleware(app: INestApplication) {
  app.use((req: Request, res: Response, next: () => void) => {
    if (isScannerProbePath(req.path || req.url || '')) {
      return res.status(404).json({ error: 'Not found' });
    }

    return next();
  });
}

export function disableNestDefaultNotFoundHandler(
  app: INestApplication
): () => void {
  const adapter = getHttpAdapter(app);
  const setNotFoundHandler = adapter.setNotFoundHandler;

  if (typeof setNotFoundHandler !== 'function') {
    return () => {};
  }

  // Suppress every not-found hook Nest tries to register during app.init(), then
  // append the final handler after lifecycle-time adapter routes are mounted.
  adapter.setNotFoundHandler = (): undefined => undefined;

  return () => {
    adapter.setNotFoundHandler = setNotFoundHandler;
  };
}

export async function initWithAdapterNotFoundHandler(app: INestApplication) {
  const restoreNestDefaultNotFoundHandler =
    disableNestDefaultNotFoundHandler(app);

  try {
    await app.init();
  } finally {
    restoreNestDefaultNotFoundHandler();
  }

  registerAdapterNotFoundHandler(app);
}

export function registerAdapterNotFoundHandler(app: INestApplication) {
  const adapter = getHttpAdapter(app);
  const instance = adapter.getInstance?.();

  if (!instance) {
    throw new Error('HTTP adapter does not expose an Express middleware hook');
  }

  // Any adapter route mounted after this helper is unreachable. Keep this call
  // immediately before listen(), after all bootstrap-time mounts are complete.
  instance.use(createAdapterNotFoundHandler());
  instance.use(createAdapterExceptionHandler(app));
}

function createAdapterNotFoundHandler(): NotFoundHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next();
    }

    const exception = new NotFoundException(
      `Cannot ${req.method} ${getRequestPath(req)}`
    );

    return next(exception);
  };
}

function createAdapterExceptionHandler(
  app: INestApplication
): ErrorRequestHandler {
  const exceptionFilter = new BaseExceptionFilter(getHttpAdapter(app));

  return (exception, req, res, next) => {
    if (res.headersSent) {
      return next(exception);
    }

    return exceptionFilter.catch(
      exception,
      createArgumentsHost(req, res, next)
    );
  };
}

function getHttpAdapter(app: INestApplication): AdapterWithNotFoundHandler {
  return app.getHttpAdapter() as AdapterWithNotFoundHandler;
}

function getRequestPath(req: Request) {
  return req.originalUrl || req.url || req.path || '/';
}

function createArgumentsHost(
  req: Request,
  res: Response,
  next: NextFunction
): ArgumentsHost {
  const args = [req, res, next];

  return {
    getArgs: () => args,
    getArgByIndex: (index: number) => args[index],
    switchToRpc: () => ({
      getData: () => undefined,
      getContext: () => undefined,
    }),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => next,
    }),
    switchToWs: () => ({
      getClient: () => undefined,
      getData: () => undefined,
    }),
    getType: () => 'http',
  } as ArgumentsHost;
}
