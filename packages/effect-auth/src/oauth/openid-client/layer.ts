import { Effect, Layer } from "effect";

import { OAuthProtocol } from "../OAuthProtocol";
import type {
  OpenIdClientOAuthProtocolOptions,
  OpenIdClientOAuthProvider,
  OpenIdClientOidcProvider,
} from "./models";
import { resolveOptions, resolveProvider, type ProviderOptions } from "./options";
import { makeOpenIdClientOAuthProtocol } from "./protocol";

export type Provider<R = never> = ProviderOptions<
  | (Omit<OpenIdClientOidcProvider, "scopes"> & { readonly scopes?: ReadonlyArray<string> })
  | (Omit<OpenIdClientOAuthProvider<R>, "scopes"> & { readonly scopes?: ReadonlyArray<string> })
>;

export interface Options<R = never> {
  readonly providers: ReadonlyArray<Provider<R>>;
  /** Per-request timeout in seconds, from 1 to 30. Defaults to 10. */
  readonly timeoutSeconds?: number;
  /** Trusted transport: honor abort; never retry token requests or log credentials. */
  readonly fetch?: OpenIdClientOAuthProtocolOptions<R>["fetch"];
}

/** One protocol Layer for all OAuth/OIDC hosts. Each provider defaults to
 * generation 1, active issuance, callback ID equal to its provider key, required
 * response issuer validation and S256 PKCE. OIDC defaults to RS256 and the openid
 * scope; plain OAuth defaults to no scopes. clientSecret uses client_secret_basic
 * unless tokenEndpointAuthMethod is supplied. Discovery must confirm the host's
 * capabilities. Invalid configuration fails when building the Layer.
 *
 * Keep retired generations in providers until their outstanding flows expire;
 * never reuse a generation for changed credentials or protocol configuration.
 * This Layer does not mount callback routes or infer a redirect URL. */
export const layer = <R = never>(options: Options<R>) =>
  Layer.effect(
    OAuthProtocol,
    resolveOptions(() => ({
      providers: options.providers.map((input) =>
        input.protocol === "oidc"
          ? {
              ...resolveProvider(input),
              scopes: input.scopes === undefined ? ["openid"] : input.scopes,
              idTokenSignedResponseAlg:
                input.idTokenSignedResponseAlg === undefined
                  ? ("RS256" as const)
                  : input.idTokenSignedResponseAlg,
            }
          : {
              ...resolveProvider(input),
              scopes: input.scopes === undefined ? [] : input.scopes,
              pkceS256: input.pkceS256 === undefined ? (true as const) : input.pkceS256,
            },
      ),
      timeoutSeconds: options.timeoutSeconds === undefined ? 10 : options.timeoutSeconds,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })).pipe(Effect.flatMap(makeOpenIdClientOAuthProtocol<R>)),
  );
