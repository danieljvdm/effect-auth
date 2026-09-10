import { Context } from "effect";

import type { AuthResolvedCall } from "../operations/credentials";

/** Supplied by the host for one request or native workflow, never a shared auth Layer.
 * @effect-leakable-service
 */
export class AuthRequest extends Context.Service<AuthRequest, AuthResolvedCall>()(
  "effect-auth/AuthRequest",
) {}
