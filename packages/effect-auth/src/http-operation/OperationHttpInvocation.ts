import { Context, Effect, Layer } from "effect";

import type { AuthInvocation } from "../operations/context";
import type { OperationHttpError } from "./errors";
import type { HttpCredentials } from "./models";

export class OperationHttpInvocation extends Context.Service<
  OperationHttpInvocation,
  {
    readonly resolve: (
      request: Request,
      credentials: HttpCredentials,
    ) => Effect.Effect<AuthInvocation, OperationHttpError>;
  }
>()("effect-auth/OperationHttpInvocation") {}

export const invocationLayer = <R>(
  resolve: (
    request: Request,
    credentials: HttpCredentials,
  ) => Effect.Effect<AuthInvocation, OperationHttpError, R>,
) =>
  Layer.effect(
    OperationHttpInvocation,
    Effect.gen(function* () {
      const services = yield* Effect.context<R>();

      return {
        resolve: (request: Request, credentials: HttpCredentials) =>
          resolve(request, credentials).pipe(Effect.provide(services)),
      };
    }),
  );
