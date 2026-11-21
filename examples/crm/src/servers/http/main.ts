import { ConsoleLogger } from '@hexok/logger';
import { MemoryStore } from '@latticecms/core';
import { serve } from 'srvx';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { createApp } from '../app.js';
import { createHttpHandler } from './handler.js';

// Phase 0: documents live in memory, and events are logged, not queued.
const logger = new ConsoleLogger();
const store = new MemoryStore();
await store.start();
const crm = createApp({
  store,
  events: new LoggingDomainEventPublisher({ logger }),
});
// The store creates each collection's declared indexes before serving.
await crm.ensure();

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: createHttpHandler(crm, { logger }),
  silent: true,
});
await server.ready();
logger.info('http listening', { url: server.url });
