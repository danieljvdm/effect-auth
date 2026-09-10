import { Effect, Schema } from "effect";

import type { PlainOAuthIdentity } from "../openid-client/models";
import { OAuthProviderKey } from "../schema";
import { OAuthProtocolRejected } from "../signInErrors";

export const gitHubOAuthAppProviderKey = OAuthProviderKey.make("github");

const identity = Schema.Struct({
  id: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  login: Schema.optionalKey(Schema.NonEmptyString.check(Schema.isMaxLength(256))),
});

// oxlint-disable-next-line no-restricted-properties -- GitHub /user is an untyped, freshly authenticated JSON boundary.
const decode = Schema.decodeUnknownEffect(identity);

export const decodeGitHubIdentity = Effect.fn("GitHubOAuthApp.decodeIdentity")(function* (
  body: unknown,
): Effect.fn.Return<PlainOAuthIdentity, OAuthProtocolRejected> {
  const value = yield* decode(body).pipe(Effect.mapError(() => OAuthProtocolRejected.make({})));

  return {
    subject: String(value.id),
    ...(value.login === undefined ? {} : { profile: { displayName: value.login } }),
  };
});
