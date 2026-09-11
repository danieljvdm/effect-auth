import { Effect, Layer } from "effect";

import { OAuthConnectedProtocol } from "../OAuthConnectedProtocol";
import { OAuthProtocol } from "../OAuthProtocol";
import { OpenIdClientConfigurationError } from "../openid-client/models";
import {
  resolveOptions,
  resolveRegistration,
  type RegistrationOptions,
} from "../openid-client/options";
import type {
  GitHubOAuthAppConnectedProtocolOptions,
  GitHubOAuthAppGeneration,
  GitHubOAuthAppProtocolOptions,
} from "./models";
import {
  gitHubOAuthAppProvider,
  makeGitHubOAuthAppConnectedProtocol,
  makeGitHubOAuthAppProtocol,
} from "./protocol";

/** GitHub.com OAuth App credentials and one or more exact callback destinations. */
export type Registration = Pick<GitHubOAuthAppGeneration, "clientId" | "clientSecret"> &
  RegistrationOptions;

type Transport = {
  /** Per-request timeout in seconds, from 1 to 30. Defaults to 10. */
  readonly timeoutSeconds?: number;
  /** Trusted transport: honor abort; never retry token requests or log credentials. */
  readonly fetch?: GitHubOAuthAppProtocolOptions["fetch"];
};

export type Options = Transport &
  (Registration | { readonly registrations: ReadonlyArray<Registration> });

export type ConnectedRegistration = Registration &
  Pick<GitHubOAuthAppConnectedProtocolOptions["registrations"][number], "profiles">;

export type ConnectedOptions = Transport &
  (ConnectedRegistration | { readonly registrations: ReadonlyArray<ConnectedRegistration> });

const registration = (input: Registration): GitHubOAuthAppGeneration => ({
  ...input,
  ...resolveRegistration(input, "github"),
});

/** Configure GitHub alongside other hosts in OpenIdClient.layer. Performs no I/O;
 * invalid input throws OpenIdClientConfigurationError without retaining secrets. */
export const provider = (input: Registration) => {
  try {
    return gitHubOAuthAppProvider(registration(input));
  } catch {
    throw OpenIdClientConfigurationError.make({ reason: "provider" });
  }
};

/** GitHub OAuth sign-in. Defaults to callback ID github, generation 1, active
 * issuance and a 10-second request timeout. Does not install HTTP routes.
 * For rotation, provide registrations with one active generation and retain
 * retired generations through their issued flows' lifetime. Configuration is
 * validated when the Layer builds; existing protocol safety rules still apply. */
export const layer = (options: Options) =>
  Layer.effect(
    OAuthProtocol,
    resolveOptions(() => ({
      registrations: ("registrations" in options ? options.registrations : [options]).map(
        registration,
      ),
      timeoutSeconds: options.timeoutSeconds === undefined ? 10 : options.timeoutSeconds,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })).pipe(Effect.flatMap(makeGitHubOAuthAppProtocol)),
  );

/** Configure GitHub API connections with the same callback/rotation defaults as
 * layer. Permission profiles remain explicit; connection grants are not logins. */
export const layerConnected = (options: ConnectedOptions) =>
  Layer.effect(
    OAuthConnectedProtocol,
    resolveOptions(() => ({
      registrations: ("registrations" in options ? options.registrations : [options]).map(
        (input) => ({
          ...registration(input),
          profiles: input.profiles,
        }),
      ),
      timeoutSeconds: options.timeoutSeconds === undefined ? 10 : options.timeoutSeconds,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    })).pipe(Effect.flatMap(makeGitHubOAuthAppConnectedProtocol)),
  );
