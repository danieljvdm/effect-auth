import { Effect, Layer, Schema } from "effect";
import { Auth, Password, Passkey, PhoneOtp, Sessions } from "effect-auth";
import * as AuthHttp from "effect-auth/Http";
import type { RequestBindingConfiguration } from "effect-auth/Operations";
import type { ProofKeyring } from "effect-auth/Proofs";

const AccountClaims = Schema.Struct({
  accountId: Schema.String,
  displayName: Schema.String,
});

/** Call once at the application's composition root with its decoded configuration.
 * The returned Layer requires the application's persistence and account authorities
 * plus SmsProofDelivery. Each adapter can provide several related services together.
 */
export const makeApplicationAuth = (configuration: {
  readonly relyingParty: {
    readonly id: string;
    readonly name: string;
    readonly origins: readonly string[];
  };
  readonly phoneKeys: ProofKeyring;
  readonly requestBinding: RequestBindingConfiguration;
  readonly sessions: Sessions.SessionOptions;
  readonly origin: string;
}) => {
  const AppAuth = Auth.define("app/Auth", {
    claims: AccountClaims,
    sessions: Sessions.stateful(configuration.sessions),
    strategies: {
      password: Password.make(),
      passkey: Passkey.make({ relyingParty: configuration.relyingParty }),
      phone: PhoneOtp.make({ template: "sign-in-code", keys: configuration.phoneKeys }),
    },
    defaultStrategy: "password",
  });

  const AuthLive = AppAuth.layer.pipe(
    Layer.provide(Auth.RequestBindingConfig.layer(configuration.requestBinding)),
  );

  const http = AuthHttp.make(AppAuth, { origin: configuration.origin });

  const AuthRoutes = http
    .routes({
      session: "/auth/session",
      signOut: "/auth/sign-out",
      renew: "/auth/renew",
    })
    .pipe(http.middleware);

  // Application code contains its own projection; auth owns request and cookie mechanics.
  const currentMember = Effect.fn("app.currentMember")(function* () {
    const auth = yield* AppAuth;
    const session = yield* auth.requireSession();

    return { subjectId: session.subjectId, name: session.claims.displayName };
  });

  // In any handler covered by http.middleware:
  // const auth = yield* AppAuth;
  // yield* auth.signIn({ email, password });
  // yield* auth.signIn("phone", { phoneNumber });
  // yield* auth.signOut();

  // Application composition:
  // const AuthDependenciesLive = Layer.mergeAll(PersistenceLive, AccountsLive, SmsLive);
  // const AppLive = AuthRoutes.pipe(
  //   Layer.provide(AuthLive.pipe(Layer.provide(AuthDependenciesLive))),
  // );
  // AccountsLive implements AppAuth.strategies.password.ClaimsForPassword,
  // AppAuth.strategies.passkey.ClaimsForPasskey, AppAuth.strategies.phone.ClaimsForPhone
  // and Sessions.AuthenticationAuthority for this account model.
  // PersistenceLive supplies session/password/passkey/proof storage and exact credential lookups.
  return {
    AppAuth,
    AuthLive,
    http,
    AuthRoutes,
    currentMember,
  };
};
