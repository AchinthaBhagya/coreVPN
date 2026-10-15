import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { env } from './config/env';
import logger from './config/logger';
import { apiLimiter } from './middleware/rateLimit';
import { csrfProtection } from './middleware/csrf';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { routes } from './routes';

/** Builds the fully-wired Express application (no listener). */
export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Files are served through authenticated endpoints, not cross-origin embeds.
      crossOriginResourcePolicy: { policy: 'same-origin' },
      contentSecurityPolicy: env.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:', 'blob:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
    }),
  );

  app.use(
    cors({
      origin: env.corsOrigin,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Broad rate limiting + CSRF protection across the API surface.
  app.use('/api', apiLimiter);
  app.use('/api', csrfProtection);

  app.use('/api', routes);

  // In production the built SPA is served from the same origin as the API.
  if (env.isProduction) {
    const clientDist = path.resolve(__dirname, '../../frontend/dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api')) return next();
        return res.sendFile(path.join(clientDist, 'index.html'));
      });
    } else {
      logger.warn('Production build requested but frontend/dist was not found', { clientDist });
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
