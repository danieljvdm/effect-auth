import type {
  OpenIdClientConnectedOAuthProvider,
  OpenIdClientConnectedProtocolOptions,
} from "./connected/models";

/** Pure private provider rules, never part of the generic public options. */
export interface TokenCompatibility {
  readonly inspectReceipt: (
    receipt: {
      readonly body: unknown;
      readonly status: number;
      readonly contentType: string | null;
    },
    input: {
      readonly scopes: ReadonlyArray<string>;
      readonly refreshRequired: boolean;
      readonly operation: "authorization_code" | "refresh_token";
    },
  ) => void;
}

export class DefiniteTokenRejection extends Error {}

export interface ConnectedCompatibility extends TokenCompatibility {
  readonly authorizationScopes: (
    scopes: ReadonlyArray<string>,
    refresh: boolean,
  ) => ReadonlyArray<string>;
  readonly decodeScopes: (
    receipt: string | undefined,
    expected: ReadonlyArray<string>,
  ) => ReadonlyArray<string>;
  readonly includeRefreshScope: boolean;
}

export type ProviderConnectedOAuth<R> = Omit<
  OpenIdClientConnectedOAuthProvider<R>,
  "revocation"
> & {
  readonly revocation: { readonly mode: "provider-cohort" };
};

export type ConnectedOptions<R> = Omit<OpenIdClientConnectedProtocolOptions<R>, "providers"> & {
  readonly providers: ReadonlyArray<
    OpenIdClientConnectedProtocolOptions<R>["providers"][number] | ProviderConnectedOAuth<R>
  >;
};
