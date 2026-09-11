import { Schema } from "effect";

import { HookDenied } from "../hooks/models";
import { action } from "../operations/actions";
import { OAuthRegistrationRequired } from "./registrationModels";
import { OAuthMethodUnsupported, OAuthRejected, OAuthUnavailable } from "./signInErrors";
import {
  OAuthReturnTarget,
  OAuthSignInAuthorization,
  OAuthSignInBegin,
  OAuthSignInComplete,
} from "./signInModels";

const Failure = Schema.Union([OAuthRejected, OAuthUnavailable, OAuthMethodUnsupported, HookDenied]);

export const completionResult = <S extends Schema.Top>(schema: S) =>
  Schema.Union([
    Schema.Struct({ completion: schema, returnTarget: OAuthReturnTarget }),
    Schema.TaggedStruct("Cancelled", { returnTarget: OAuthReturnTarget }),
    OAuthRegistrationRequired,
  ]);

/** Shared begin action. Credentials are delivered by the request boundary. */
export const signIn = (options?: { readonly strategy?: string }) =>
  action({
    payload: OAuthSignInBegin,
    success: OAuthSignInAuthorization,
    error: Failure,
    mode: "mutation",
    credentials: true,
    method: "signIn",
    ...options,
  });

type Completion =
  | { readonly _tag: "Authenticated"; readonly session: { readonly subjectId: string } }
  | { readonly _tag: "PendingAuthentication" };

/** Identifies the callback capability explicitly, including its private binding
 * and single-use contract. The public action name may be chosen by the app. */
export const completeSignIn = <S extends Schema.Codec<Completion, unknown, unknown, unknown>>(
  schemas: { readonly CompletionResult: S },
  options?: { readonly strategy?: string },
) =>
  action({
    payload: Schema.Struct({
      flowId: OAuthSignInComplete.fields.flowId,
      provider: OAuthSignInComplete.fields.provider,
      callbackId: OAuthSignInComplete.fields.callbackId,
      response: OAuthSignInComplete.fields.response,
    }),
    success: completionResult(schemas.CompletionResult),
    error: Failure,
    mode: "mutation",
    replay: "single-use",
    credentials: true,
    method: "completeSignIn",
    oauthCallback: true,
    requestFields: { requestBinding: "request-binding" },
    ...options,
    subject: {
      fromSuccess: (value) =>
        "completion" in value && value.completion._tag === "Authenticated"
          ? value.completion.session.subjectId
          : undefined,
    },
  });
