import { BunRuntime } from "@effect/platform-bun";
import { DateTime, Effect, Layer } from "effect";
import {
  identityQueryLayer,
  InspectIdentity,
  numericSubjectId,
  stringSubjectId,
} from "effect-auth/Identity";
import { AuthenticationAssurance, guest, remoteGroup } from "effect-auth/Operations";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { shopperIdentity, staffIdentity } from "./identity-consumers";

const staffHandlers = identityQueryLayer.pipe(Layer.provide(staffIdentity));
const shopperHandlers = identityQueryLayer.pipe(Layer.provide(shopperIdentity));
const networkOperations = remoteGroup([InspectIdentity]);

/** No authentication is inferred from payloads or caller-supplied subject headers. */
const rpcHandlers = networkOperations
  .toLayer({
    "identity.inspect": InspectIdentity.rpcHandler(() => Effect.succeed(guest)),
  })
  .pipe(Layer.provide(staffHandlers));

const httpLayer = RpcServer.layerHttp({
  group: networkOperations,
  path: "/auth",
  protocol: "http",
}).pipe(Layer.provide(rpcHandlers), Layer.provide(RpcSerialization.layerJson));

const program = Effect.gen(function* () {
  const authenticatedAt = yield* DateTime.now;

  const assurance = AuthenticationAssurance.make({
    method: "consumer-verified-credential",
    factors: ["possession"],
    authenticatedAt,
  });

  const staffId = yield* stringSubjectId.toSubject("01991ac9-e630-7ef2-9577-af4d762fa101");
  const shopperId = yield* numericSubjectId.toSubject(42);

  const employee = yield* InspectIdentity.invoke(
    { _tag: "Authenticated", subjectId: staffId, assurance },
    undefined,
  ).pipe(Effect.provide(staffHandlers));

  const shopper = yield* InspectIdentity.invoke(
    { _tag: "Authenticated", subjectId: shopperId, assurance },
    undefined,
  ).pipe(Effect.provide(shopperHandlers));

  const localGuest = yield* Effect.result(
    InspectIdentity.invoke(guest, undefined).pipe(Effect.provide(staffHandlers)),
  );

  yield* Effect.log({ employee, shopper, localGuest });

  // Fetch host boundary. A production host supplies its credential-verifying
  // resolver per request; the guest-only example deliberately denies this call.
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => HttpRouter.toWebHandler(httpLayer, { disableLogger: true })),
    (server) => Effect.promise(() => server.dispose()),
  );

  const response = yield* Effect.tryPromise(() =>
    server.handler(
      new Request("http://example.local/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // oxlint-disable-next-line no-restricted-properties -- Effect RPC's external message envelope.
        body: JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "identity.inspect",
          payload: null,
          headers: [],
        }),
      }),
    ),
  );

  const body = yield* Effect.tryPromise(() => response.text());

  yield* Effect.log({ remoteGuest: body });
}).pipe(Effect.scoped);

BunRuntime.runMain(program);
