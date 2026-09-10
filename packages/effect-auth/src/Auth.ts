export { type AuthApi, type Options, Service, define, make } from "./auth/Auth";
export { AuthConfigurationError } from "./auth/AuthConfigurationError";
export { type AuthMethod, makeAuthStrategy as makeStrategy } from "./auth/AuthStrategy";

export type {
  BindingOf,
  ClaimsCodec,
  StrategyBinding,
  StrategyDefinition,
  StrategyTypeLambda,
} from "./auth/definition";

export { AuthRequest } from "./auth/AuthRequest";
export { RequestBindingConfig } from "./operations/RequestBindingConfig";
