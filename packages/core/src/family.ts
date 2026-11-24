import type { Logger } from '@hexok/logger';
import { type Attributes, type Span, SpanKind } from '@opentelemetry/api';
import type { McpEffect } from '@ts-pf/mcp/meta';
import { type StandardSchemaV1, UseCase } from 'hexok';
import { z } from 'zod';
import { CallAccess } from './access.js';
import type { AnyCollection } from './collection.js';
import { invalid, LatticeError, refusal } from './errors.js';
import { withheldPaths, withheldWrites } from './mask.js';
import { type Tenant, tenancy } from './tenancy.js';
import { failed, tracer } from './tracing.js';

/**
 * The statics every use case in a Lattice family declares. A method also
 * declares `summary` (one sentence on what it does) and `effect`, which
 * become its procedure's docs and MCP meta. An override declares neither:
 * it keeps the operation's own.
 */
export type FamilySpec = {
  readonly collection: AnyCollection;
  readonly input?: z.core.$ZodType;
  readonly output?: z.core.$ZodType;
  readonly summary?: string;
  readonly effect?: McpEffect;
};

/**
 * What a caller gives each call: the edge's context function, a
 * `createLocalClient` context, or `build().context()`. The edge passes
 * `rootLogger.child({ requestId })`; workers and tests pass their own.
 */
export type CallContext<Actor> = {
  readonly actor: Actor;
  readonly logger: Logger;
};

/**
 * The per-call context of a Lattice family: the caller's, plus the call's
 * access, which Lattice adds (0023).
 */
export type FamilyContext<Actor> = CallContext<Actor> & {
  readonly access: CallAccess;
};

/**
 * A Lattice family: a hexok `UseCase.context` factory, its actor schema, the
 * id of an actor as log lines and the generated events carry it, and the
 * actor's tenant. `Tenanted` is true when the family has `tenantOf`, so a
 * tenanted collection in a family without it is a compile error.
 */
export type Family<
  Actor,
  Tenanted extends boolean = boolean,
> = UseCase.ContextFactory<FamilyContext<Actor>, FamilySpec> & {
  readonly actor: StandardSchemaV1<unknown, Actor>;
  readonly actorId: (actor: Actor) => string;
  readonly tenantOf: ((actor: Actor) => Tenant) | undefined;
  /** Type-only. */
  readonly '~tenanted'?: Tenanted;
};

/**
 * The fields that say who made a call, for its log lines: the actor's id,
 * and its tenant id or `tenancy: 'bypass'`.
 */
export function callerFields<Actor>(
  family: Pick<Family<Actor>, 'actorId' | 'tenantOf'>,
  actor: Actor,
): Readonly<Record<string, string>> {
  const actorId = family.actorId(actor);
  const tenant = family.tenantOf?.(actor);
  if (tenant === undefined) return { actorId };
  if (tenant === tenancy.bypass) return { actorId, tenancy: 'bypass' };
  return { actorId, tenantId: tenant };
}

/** How a family logged an error: at info as a refusal, or at error. */
export type Logged = 'refused' | 'failed';

/**
 * The errors a family has logged, its guards' rejections and what `onCatch`
 * saw, with how. The procedure middleware skips both outcomes; the edge's
 * `onError` skips only failures, so a refusal the client sees as INTERNAL
 * still reaches it. A WeakMap keeps the error object as it is and holds it
 * no longer than the caller.
 */
const logged = new WeakMap<object, Logged>();

/** How a family logged `error`, or undefined when no family did. */
export function loggedByFamily(error: unknown): Logged | undefined {
  return typeof error === 'object' && error !== null
    ? logged.get(error)
    : undefined;
}

/** The action of `token`: a generated operation's or a method's name. */
function actionOf(spec: FamilySpec, token: string): string {
  const { slug } = spec.collection;
  return token.startsWith(`${slug}.`) ? token.slice(slug.length + 1) : token;
}

/**
 * The logger of one call: `ctx.logger` with the call's collection, action
 * and, once the actor has parsed, its id and tenant. Every family log line
 * goes through it, so the fields cannot drift.
 */
function callLogger(
  logger: Logger,
  spec: FamilySpec,
  token: string,
  caller: Readonly<Record<string, string>> | undefined,
): Logger {
  return logger.child({
    collection: spec.collection.slug,
    action: actionOf(spec, token),
    ...caller,
  });
}

/**
 * Logs a thrown value once and records it: info for a refusal, error for
 * anything else. Returns it, so a guard can throw it.
 */
function logThrown(
  log: Logger,
  token: string,
  error: unknown,
  durationMs?: number,
): unknown {
  const timing = durationMs === undefined ? {} : { durationMs };
  const refused = refusal(error);
  if (refused !== undefined) {
    log.info(token, { outcome: 'refused', ...refused, ...timing });
  } else if (error instanceof Error) {
    log.error(error, { outcome: 'failed', ...timing });
  } else {
    log.error(token, { outcome: 'failed', thrown: error, ...timing });
  }
  if (typeof error === 'object' && error !== null) {
    logged.set(error, refused === undefined ? 'failed' : 'refused');
  }
  return error;
}

/**
 * Builds the app's one use case family on hexok `UseCase.context`. Before
 * any member's `execute` runs, the actor must parse against `actor`, the
 * input against the member's `input` static, and `ctx.access` must allow
 * the member's action. Each call writes one line
 * through a child of `ctx.logger`: info when it returns or a guard or
 * `execute` refuses it, error when it throws anything else.
 */
export function family<
  A extends StandardSchemaV1,
  T extends Tenant = never,
>(options: {
  actor: A;
  /** The id the call's log lines and the generated events carry as `actorId`. */
  actorId: (actor: StandardSchemaV1.InferOutput<A>) => string;
  /**
   * The actor's tenant id, or `tenancy.bypass` for a platform actor that
   * reads across tenants. Required by a framework with a tenanted
   * collection.
   */
  tenantOf?: (actor: StandardSchemaV1.InferOutput<A>) => T;
}): Family<
  StandardSchemaV1.InferOutput<A>,
  [T] extends [never] ? false : true
> {
  const caller = (actor: StandardSchemaV1.InferOutput<A>) =>
    callerFields(
      { actorId: options.actorId, tenantOf: options.tenantOf },
      actor,
    );
  const factory = UseCase.context<
    FamilyContext<StandardSchemaV1.InferOutput<A>>,
    FamilySpec
  >()
    // Guards run outside hexok's hooks, so each logs its own rejection.
    .guard(({ ctx, spec, token }) => {
      // The call's context parsed the actor once (familyContext), so this
      // guard reads that parse rather than repeating it. The issues describe
      // the caller's credentials, so they stay out of the error and the log.
      if (!CallAccess.parsed(ctx.access, ctx.actor)) {
        const log = callLogger(ctx.logger, spec, token, undefined);
        throw logThrown(log, token, LatticeError.UNAUTHORIZED());
      }
    })
    .guard(({ ctx, spec, token, input }) => {
      // hexok hands execute the caller's input, not the parsed value. So a
      // method's input schema uses no defaults or transforms; a generated use
      // case parses its own input inside execute to strip unknown keys and
      // apply defaults.
      if (spec.input === undefined) return;
      const result = z.safeParse(spec.input, input);
      if (!result.success) {
        const log = callLogger(ctx.logger, spec, token, caller(ctx.actor));
        throw logThrown(log, token, invalid(result.error.issues));
      }
    })
    // Access, after the actor and the input are known good. Generated
    // operations, overrides and methods all pass here, so none can skip the
    // FORBIDDEN check. The answer stays on ctx.access for execute's scope.
    .guard(async ({ ctx, spec, token, input }) => {
      const action = actionOf(spec, token);
      // Create's function receives the parsed input, as execute will see it.
      const data =
        action !== 'create'
          ? undefined
          : spec.input === undefined
            ? input
            : z.parse(spec.input, input);
      try {
        await ctx.access.scope(spec.collection, action, data);
      } catch (error) {
        const log = callLogger(ctx.logger, spec, token, caller(ctx.actor));
        throw logThrown(log, token, error);
      }
    })
    // A where or a sort on a field the caller's rules withhold would reveal
    // it through which rows match or their order, and an update would change
    // a value the caller cannot see (0035), so each is refused, on every
    // path. Output masking happens where a client receives the result.
    .guard(async ({ ctx, spec, token, input }) => {
      const action = actionOf(spec, token);
      if (action !== 'find' && action !== 'count' && action !== 'update') {
        return;
      }
      const withheld = await CallAccess.withheld(ctx.access, spec.collection);
      if (withheld.size === 0) return;
      const issues =
        action === 'update'
          ? withheldWrites(input, withheld)
          : withheldPaths(input, withheld);
      if (issues.length > 0) {
        const log = callLogger(ctx.logger, spec, token, caller(ctx.actor));
        throw logThrown(log, token, LatticeError.VALIDATION({ issues }));
      }
    })
    .hooks({
      preExecute: ({ ctx, spec, token }) => {
        const fields = caller(ctx.actor);
        return {
          log: callLogger(ctx.logger, spec, token, fields),
          started: performance.now(),
          span: useCaseSpan(spec, token, fields),
        };
      },
      // The span ends in postExecute and onCatch, beside the log line,
      // rather than in its own onFinally: each hook is one more await on
      // every call, traced or not.
      postExecute: ({ token }, { log, started, span }) => {
        log.info(token, { outcome: 'ok', durationMs: since(started) });
        if (span.isRecording()) span.setAttribute('lattice.outcome', 'ok');
        span.end();
      },
      onCatch: ({ ctx, spec, token, error }, state) => {
        // State is undefined only when preExecute itself threw.
        if (state === undefined) {
          logThrown(
            callLogger(ctx.logger, spec, token, undefined),
            token,
            error,
          );
        } else {
          logThrown(state.log, token, error, since(state.started));
          const refused = refusal(error);
          if (refused === undefined) {
            failed(state.span, error);
          } else if (state.span.isRecording()) {
            // A refusal is not a failure: the status stays UNSET.
            state.span.setAttributes({
              'lattice.outcome': 'refused',
              'lattice.code': String(refused.code),
            });
          }
          state.span.end();
        }
      },
    });
  // The generated use cases and the procedure middleware read these, so the
  // app states them once.
  return Object.assign(factory, {
    actor: options.actor,
    actorId: options.actorId,
    tenantOf: options.tenantOf,
  });
}

/**
 * The use case's span: a child of the active span, the procedure's or a
 * direct caller's. hexok has no around hook, so this span cannot be made
 * active for execute: the store calls execute makes are its siblings, not
 * its children. Its attributes are set only when a span records, so
 * without an SDK they cost nothing.
 */
function useCaseSpan(
  spec: FamilySpec,
  token: string,
  caller: Readonly<Record<string, string>>,
): Span {
  const span = tracer.startSpan(token, { kind: SpanKind.INTERNAL });
  if (span.isRecording()) span.setAttributes(spanFields(spec, token, caller));
  return span;
}

/**
 * A use case span's attributes: what ran and for whom, never its input or
 * a document. The caller's fields are its log line's.
 */
function spanFields(
  spec: FamilySpec,
  token: string,
  caller: Readonly<Record<string, string>>,
): Attributes {
  return {
    'lattice.use_case': token,
    'lattice.collection': spec.collection.slug,
    'lattice.action': actionOf(spec, token),
    ...(caller.actorId === undefined
      ? {}
      : { 'lattice.actor_id': caller.actorId }),
    ...(caller.tenantId === undefined
      ? {}
      : { 'lattice.tenant_id': caller.tenantId }),
    ...(caller.tenancy === undefined
      ? {}
      : { 'lattice.tenancy': caller.tenancy }),
  };
}

function since(started: number): number {
  return Math.round(performance.now() - started);
}
