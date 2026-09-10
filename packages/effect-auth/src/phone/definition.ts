import type {
  BindingOf,
  ClaimsCodec,
  StrategyBinding,
  StrategyDefinition,
  StrategyTypeLambda,
} from "../auth/definition";
import { makePhoneOtp, snapshotPhoneConfiguration } from "./module";

export type PhoneOtpOptions<Namespace extends string | undefined = undefined> = Omit<
  Parameters<typeof makePhoneOtp>[1],
  "sessions"
> & { readonly namespace?: Namespace };

/** Bind the phone method to its Auth definition; runtime authorities come from Layers. */
const captureDefine = <const Namespace extends string | undefined>(
  _namespace: Namespace,
  input: PhoneOtpOptions<Namespace>,
) => {
  const options = snapshotPhoneConfiguration(input);

  return { options };
};

const bindDefine = <
  const Namespace extends string | undefined,
  Claims extends ClaimsCodec,
  const Id extends string,
  const SessionId extends string,
>(
  binding: StrategyBinding<Claims, Id, SessionId>,
  captured: ReturnType<typeof captureDefine<Namespace>>,
) => {
  const { options } = captured;

  return makePhoneOtp<Id, SessionId, Claims>(binding.namespace, {
    ...options,
    sessions: binding.sessions,
  });
};

export interface DefineStrategy<Namespace extends string | undefined> extends StrategyTypeLambda {
  readonly type: ReturnType<
    typeof bindDefine<
      Namespace,
      BindingOf<this>["claims"],
      BindingOf<this>["namespace"],
      BindingOf<this>["sessionNamespace"]
    >
  >;
}

const define = <const Namespace extends string | undefined>(
  namespace: Namespace,
  input: PhoneOtpOptions<Namespace>,
) => {
  const captured = captureDefine<Namespace>(namespace, input);

  const bind = <
    Claims extends ClaimsCodec,
    const Id extends string,
    const SessionId extends string,
  >(
    binding: StrategyBinding<Claims, Id, SessionId>,
  ) => bindDefine<Namespace, Claims, Id, SessionId>(binding, captured);

  const definition: StrategyDefinition<DefineStrategy<Namespace>, Namespace> = {
    namespace,
    bind,
  };

  return Object.freeze(definition);
};

export function make<const Namespace extends string>(
  options: PhoneOtpOptions<Namespace> & { readonly namespace: Namespace },
): ReturnType<typeof define<Namespace>>;

export function make<const Namespace extends string | undefined = undefined>(
  options: PhoneOtpOptions<Namespace>,
): ReturnType<typeof define<Namespace | undefined>>;

export function make<const Namespace extends string | undefined>(
  options: PhoneOtpOptions<Namespace>,
) {
  return define(options.namespace, options);
}
