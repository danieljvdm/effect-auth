import { Effect, Layer, Schema } from "effect";
import type { Sessions } from "effect-auth";
import { Auth, Password, Passkey, PhoneOtp } from "effect-auth";
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
  readonly sessions: Sessions.SessionPolicy;
}) => {
  class AppAuth extends Auth.Service<AppAuth>()("app/Auth", {
    claims: AccountClaims,
    strategies: {
      password: Password.make(),
      passkey: Passkey.make({ relyingParty: configuration.relyingParty }),
      phone: PhoneOtp.make({ template: "sign-in-code", keys: configuration.phoneKeys }),
    },
    defaultStrategy: "password",
  }) {}

  const AuthLive = AppAuth.layer.pipe(
    Layer.provide(AppAuth.sessions.layer(configuration.sessions)),
    Layer.provide(Auth.RequestBindingConfig.layer(configuration.requestBinding)),
  );

  // Run these effects in request handlers. The host supplies Auth.AuthRequest and
  // delivers its credential commands to cookies or the native credential store.
  const signInWithPassword = Effect.fn("app.signInWithPassword")(function* (
    email: string,
    password: string,
  ) {
    const auth = yield* AppAuth;

    return yield* auth.signIn({ email, password });
  });

  const requestPhoneCode = Effect.fn("app.requestPhoneCode")(function* (phoneNumber: string) {
    const auth = yield* AppAuth;

    return yield* auth.signIn("phone", { phoneNumber });
  });

  const beginPasskey = Effect.fn("app.beginPasskey")(function* (flowId: string, commandId: string) {
    const auth = yield* AppAuth;

    return yield* auth.signIn("passkey", { flowId, commandId, profileId: "default" });
  });

  const completePasskey = Effect.fn("app.completePasskey")(function* (
    input: typeof Passkey.PasskeyComplete.Encoded,
  ) {
    const auth = yield* AppAuth;

    return yield* auth.completeSignIn("passkey", input);
  });

  const completePhone = Effect.fn("app.completePhone")(function* (
    input: typeof PhoneOtp.PhoneOtpComplete.Encoded,
  ) {
    const auth = yield* AppAuth;

    return yield* auth.completeSignIn("phone", input);
  });

  // Application composition:
  // const AuthDependenciesLive = Layer.mergeAll(PersistenceLive, AccountsLive, SmsLive);
  // const AppLive = HttpLive.pipe(
  //   Layer.provide(AuthLive.pipe(Layer.provide(AuthDependenciesLive))),
  // );
  // AccountsLive implements AppAuth.strategies.password.ClaimsForPassword,
  // AppAuth.strategies.passkey.ClaimsForPasskey, AppAuth.strategies.phone.ClaimsForPhone
  // and Sessions.AuthenticationAuthority for this account model.
  // PersistenceLive supplies session/password/passkey/proof storage and exact credential lookups.
  return {
    AppAuth,
    AuthLive,
    signInWithPassword,
    requestPhoneCode,
    beginPasskey,
    completePasskey,
    completePhone,
  };
};
