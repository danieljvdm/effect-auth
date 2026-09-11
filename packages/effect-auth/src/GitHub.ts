export {
  type GitHubOAuthAppConnectedProtocolOptions,
  type GitHubOAuthAppGeneration,
  type GitHubOAuthAppProtocolOptions,
} from "./oauth/github/models";

export { OpenIdClientConfigurationError } from "./oauth/openid-client/models";

export {
  gitHubOAuthAppConnectedProtocolLayer,
  gitHubOAuthAppProtocolLayer,
  gitHubOAuthAppProvider,
  makeGitHubOAuthAppConnectedProtocol,
  makeGitHubOAuthAppProtocol,
} from "./oauth/github/protocol";

export { gitHubOAuthAppProviderKey } from "./oauth/github/identity";
