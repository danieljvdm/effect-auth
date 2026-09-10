import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export default Alchemy.Stack(
  "effect-auth",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const docs = yield* Cloudflare.Website.StaticSite("Docs", {
      name: "effect-auth-docs",
      command: "vp run docs:build",
      outdir: "docs/.vitepress/dist",
      domain: "effect-auth.com",
      workersDev: false,
      dev: { command: "vp run docs:dev" },
      assets: { notFoundHandling: "404-page" },
      // The home page and quick start include the root README's example.
      memo: { include: ["docs/**", "README.md", "package.json"], lockfile: true },
    });

    return { url: docs.url };
  }),
);
