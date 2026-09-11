import { Auth, Email, OAuth, Sessions } from "@yielded/auth";
import {
  gitHubOAuthAppProtocolLayer,
  gitHubOAuthAppProvider,
  type GitHubOAuthAppGeneration,
} from "@yielded/auth/GitHub";
import * as AuthHttp from "@yielded/auth/Http";
import { openIdClientOAuthProtocolLayer } from "@yielded/auth/OpenIdClient";
import type { SessionSigningKeyring } from "@yielded/auth/Sessions";
import { Config, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { LoginApi, Registration } from "./login-contract";

export const makeAppAuth = (email: Email.EmailCodeOptions) =>
  Auth.make(LoginApi, {
    sessions: Sessions.stateful(),
    strategies: {
      email: Email.makeCode({ ...email, namespace: "example/email" }),
      emailRegistration: Email.makeRegistration({
        ...email,
        namespace: "example/email",
        registration: Registration,
      }),
      social: OAuth.makeRegistration({
        namespace: "example/social-login",
        registration: Registration,
        policy: {
          generation: 1,
          lifetimeMillis: 300_000,
          claimLifetimeMillis: 30_000,
          settlementTimeoutMillis: 5_000,
          retentionMillis: 600_000,
        },
        registrationPolicy: {
          lifetimeMillis: 300_000,
          maximumVerificationAgeMillis: 300_000,
          retentionMillis: 600_000,
        },
      }),
    },
    defaultStrategy: "social",
  });

// Set this to the actual trusted HTTPS origin, not a caller-controlled Host header.
const origin = "https://app.example.com";

export const providersLayer = (includeGoogle: boolean) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const githubId = yield* Config.string("GITHUB_CLIENT_ID");
      const githubSecret = yield* Config.redacted("GITHUB_CLIENT_SECRET");

      const github: GitHubOAuthAppGeneration = {
        configurationGeneration: 1,
        issuance: "active",
        clientId: githubId,
        clientSecret: githubSecret,
        callbacks: [
          {
            callbackId: OAuth.OAuthCallbackId.make("github"),
            redirectUri: OAuth.OAuthRedirectUri.make(`${origin}/auth/github/callback`),
          },
        ],
      };

      // Email + GitHub already works with the published standalone adapter.
      if (!includeGoogle)
        return gitHubOAuthAppProtocolLayer({ registrations: [github], timeoutSeconds: 10 });

      const googleId = yield* Config.string("GOOGLE_CLIENT_ID");
      const googleSecret = yield* Config.redacted("GOOGLE_CLIENT_SECRET");

      return openIdClientOAuthProtocolLayer({
        providers: [
          gitHubOAuthAppProvider(github),
          {
            provider: OAuth.OAuthProviderKey.make("google"),
            protocol: "oidc",
            configurationGeneration: 1,
            issuance: "active",
            issuer: OAuth.OAuthIssuer.make("https://accounts.google.com"),
            responseIssuerMode: "required",
            clientId: googleId,
            authentication: { method: "client_secret_post", secret: googleSecret },
            callbacks: [
              {
                callbackId: OAuth.OAuthCallbackId.make("google"),
                redirectUri: OAuth.OAuthRedirectUri.make(`${origin}/auth/google/callback`),
              },
            ],
            scopes: ["openid"],
            idTokenSignedResponseAlg: "RS256",
          },
        ],
        timeoutSeconds: 10,
      });
    }),
  );

/** Construct once at the application's composition root. Supply durable Email
 * and OAuth registration authorities, ProofPersistence/abuse budgets, shared
 * session persistence/AuthenticationAuthority, ClaimsForEmail/ClaimsForOAuth,
 * EmailSignInTargets and EmailProofDelivery to Routes. Drizzle D1/SQLite DO
 * adapters implement the transaction ports; no example memory store is installed.
 * Every unsupplied service remains visible in the returned Layer type. */
export const makeServer = (config: {
  readonly email: Email.EmailCodeOptions;
  readonly binding: SessionSigningKeyring;
  readonly transactions: OAuth.OAuthTransactionKeyring;
  readonly google?: boolean;
}) => {
  const AppAuth = makeAppAuth(config.email);
  const http = AuthHttp.make(AppAuth, { origin });

  const ApplicationRoutes = HttpRouter.add(
    "GET",
    "/account",
    Effect.gen(function* () {
      const auth = yield* AppAuth;
      const session = yield* auth.requireSession();

      return yield* HttpServerResponse.json({
        subjectId: session.subjectId,
        displayName: session.claims.displayName,
      });
    }),
  );

  const Routes = Layer.mergeAll(http.routes(), ApplicationRoutes.pipe(http.middleware)).pipe(
    Layer.provide(AppAuth.layer),
    Layer.provide(
      Layer.mergeAll(
        providersLayer(config.google ?? false),
        Auth.RequestBindingConfig.layer({
          generation: 1,
          lifetimeMillis: 600_000,
          keyring: config.binding,
        }),
        OAuth.OAuthTransactionProtector.xchacha20poly1305(config.transactions),
        OAuth.OAuthReturnTargets.exactRoutes(["/account"]),
        Email.EmailReturnTargets.exactRoutes(["/account"]),
      ),
    ),
  );

  return { AppAuth, http, Routes };
};
