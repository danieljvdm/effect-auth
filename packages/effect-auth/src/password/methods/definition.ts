import type {
  BindingOf,
  ClaimsCodec,
  StrategyBinding,
  StrategyDefinition,
  StrategyTypeLambda,
} from "../../auth/definition";
import type { ProofKeyring, ProofSecretPolicy } from "../../proofs/crypto";
import { snapshotProofConfiguration } from "../../proofs/module";
import type { ProofPolicy } from "../../proofs/policy";
import { makePasswordMethod } from "./module";
import { type PasswordMethodPolicy, snapshotPasswordMethodPolicy } from "./policy";
import { makePasswordSignIn } from "./signIn";

export interface PasswordOptions<Namespace extends string | undefined = undefined> {
  readonly namespace?: Namespace;
  readonly policy?: PasswordMethodPolicy;
}

export interface PasswordManagementOptions<
  Registration extends ClaimsCodec,
  Namespace extends string | undefined = undefined,
> extends PasswordOptions<Namespace> {
  readonly registration: Registration;
  readonly policy: PasswordMethodPolicy;
  readonly reset: {
    readonly template: string;
    readonly secret: ProofSecretPolicy;
    readonly policy: ProofPolicy;
    readonly keys?: ProofKeyring;
  };
}

const captureSignIn = <const Namespace extends string | undefined = undefined>(
  _namespace: Namespace,
  input: PasswordOptions<Namespace>,
) => {
  const options = Object.freeze({
    ...input,
    policy: input.policy === undefined ? undefined : snapshotPasswordMethodPolicy(input.policy),
  });

  return { options };
};

const bindSignIn = <
  const Namespace extends string | undefined,
  Claims extends ClaimsCodec,
  const Id extends string,
  const SessionId extends string,
>(
  binding: StrategyBinding<Claims, Id, SessionId>,
  captured: ReturnType<typeof captureSignIn<Namespace>>,
) => {
  const { options } = captured;

  return makePasswordSignIn<Id, SessionId, Claims>(binding.namespace, {
    ...options,
    sessions: binding.sessions,
  });
};

export interface SignInStrategy<
  Namespace extends string | undefined = undefined,
> extends StrategyTypeLambda {
  readonly type: ReturnType<
    typeof bindSignIn<
      Namespace,
      BindingOf<this>["claims"],
      BindingOf<this>["namespace"],
      BindingOf<this>["sessionNamespace"]
    >
  >;
}

const signIn = <const Namespace extends string | undefined = undefined>(
  namespace: Namespace,
  input: PasswordOptions<Namespace>,
) => {
  const captured = captureSignIn<Namespace>(namespace, input);

  const bind = <
    Claims extends ClaimsCodec,
    const Id extends string,
    const SessionId extends string,
  >(
    binding: StrategyBinding<Claims, Id, SessionId>,
  ) => bindSignIn<Namespace, Claims, Id, SessionId>(binding, captured);

  const definition: StrategyDefinition<SignInStrategy<Namespace>, Namespace> = {
    namespace,
    bind,
  };

  return Object.freeze(definition);
};

const captureManagement = <
  Registration extends ClaimsCodec,
  const Namespace extends string | undefined = undefined,
>(
  _namespace: Namespace,
  input: PasswordManagementOptions<Registration, Namespace>,
) => {
  const options = Object.freeze({
    ...input,
    policy: snapshotPasswordMethodPolicy(input.policy),
    reset: snapshotProofConfiguration(input.reset),
  });

  return { options };
};

const bindManagement = <
  Registration extends ClaimsCodec,
  const Namespace extends string | undefined,
  Claims extends ClaimsCodec,
  const Id extends string,
  const SessionId extends string,
>(
  binding: StrategyBinding<Claims, Id, SessionId>,
  captured: ReturnType<typeof captureManagement<Registration, Namespace>>,
) => {
  const { options } = captured;

  return makePasswordMethod<Id, SessionId, Claims, Registration>(binding.namespace, {
    ...options,
    sessions: binding.sessions,
  });
};

export interface ManagementStrategy<
  Registration extends ClaimsCodec,
  Namespace extends string | undefined = undefined,
> extends StrategyTypeLambda {
  readonly type: ReturnType<
    typeof bindManagement<
      Registration,
      Namespace,
      BindingOf<this>["claims"],
      BindingOf<this>["namespace"],
      BindingOf<this>["sessionNamespace"]
    >
  >;
}

const management = <
  Registration extends ClaimsCodec,
  const Namespace extends string | undefined = undefined,
>(
  namespace: Namespace,
  input: PasswordManagementOptions<Registration, Namespace>,
) => {
  const captured = captureManagement<Registration, Namespace>(namespace, input);

  const bind = <
    Claims extends ClaimsCodec,
    const Id extends string,
    const SessionId extends string,
  >(
    binding: StrategyBinding<Claims, Id, SessionId>,
  ) => bindManagement<Registration, Namespace, Claims, Id, SessionId>(binding, captured);

  const definition: StrategyDefinition<ManagementStrategy<Registration, Namespace>, Namespace> = {
    namespace,
    bind,
  };

  return Object.freeze(definition);
};

export function make<Registration extends ClaimsCodec, const Namespace extends string>(
  options: PasswordManagementOptions<Registration, Namespace> & { readonly namespace: Namespace },
): ReturnType<typeof management<Registration, Namespace>>;

export function make<
  Registration extends ClaimsCodec,
  const Namespace extends string | undefined = undefined,
>(
  options: PasswordManagementOptions<Registration, Namespace>,
): ReturnType<typeof management<Registration, Namespace | undefined>>;

export function make<const Namespace extends string>(
  options: PasswordOptions<Namespace> & { readonly namespace: Namespace },
): ReturnType<typeof signIn<Namespace>>;

export function make<const Namespace extends string | undefined = undefined>(
  options?: PasswordOptions<Namespace>,
): ReturnType<typeof signIn<Namespace | undefined>>;

/** Existing-account sign-in is the default; registration and password changes are explicit. */
export function make<
  Registration extends ClaimsCodec,
  const Namespace extends string | undefined = undefined,
>(options: PasswordOptions<Namespace> | PasswordManagementOptions<Registration, Namespace> = {}) {
  return "registration" in options
    ? management(options.namespace, options)
    : signIn(options.namespace, options);
}
