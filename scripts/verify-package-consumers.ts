import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { build } from "esbuild";
import ts from "typescript-twoslash";

import { PublishManifest, withPublishManifests } from "./release-publish.ts";

class PackageConsumerError extends Schema.TaggedError<PackageConsumerError>()(
  "PackageConsumerError",
  { message: Schema.String, cause: Schema.optionalKey(Schema.Defect()) },
) {}

const probes = ["identity", "identity-root", "contracts", "atom", "root"];

const bundleConsumer = Effect.fn("packageConsumers.bundle")(function* (
  stage: string,
  probe: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const result = yield* Effect.tryPromise({
    try: () =>
      build({
        absWorkingDir: stage,
        entryPoints: [`fixtures/${probe}.ts`],
        outfile: `bundles/${probe}.mjs`,
        bundle: true,
        treeShaking: true,
        minify: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        write: false,
        metafile: true,
        logLevel: "silent",
      }),
    catch: (cause) =>
      new PackageConsumerError({ message: `Cannot bundle published consumer ${probe}`, cause }),
  });

  const outputs = Object.values(result.metafile.outputs);

  const retained = outputs.flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .map(([file]) => file),
  );

  const unwanted = retained.filter((file) => {
    if (/(?:^|\/)(?:testing|test|fixtures)\//.test(file) && !file.startsWith("fixtures/"))
      return true;
    // A key codec must not retain identity operations just because they share a barrel.
    const implementation = file.split("packages/effect-auth/dist/")[1];

    if (probe === "identity" && implementation !== undefined)
      return !["identity/codecs.mjs", "Schema.mjs"].includes(implementation);
    // Client contracts and atoms must not retain strategy implementations or cryptography.
    if (probe === "contracts" || probe === "atom")
      return /\/(?:sessions|passkey|totp)\/module\.mjs$|\/node_modules\/@noble\//.test(file);

    return false;
  });

  if (unwanted.length > 0 || outputs.some((output) => output.imports.some((item) => item.external)))
    return yield* new PackageConsumerError({
      message: `${probe} retained unexpected dependencies: ${unwanted.join(", ")}`,
    });

  for (const file of result.outputFiles) {
    yield* fs.makeDirectory(path.dirname(file.path), { recursive: true });
    yield* fs.writeFile(file.path, file.contents);
  }

  yield* Console.log(
    `Published ${probe} consumer: ${result.outputFiles.reduce((bytes, file) => bytes + file.contents.length, 0)} minified bytes (including Effect).`,
  );
});

/** Exercise the publisher's manifests in isolation: no source files or optional adapter peers. */
export const verifyPackageConsumers = Effect.fn("verifyPackageConsumers")(function* (
  repositoryRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  // TypeScript resolves package symlinks to real paths, including macOS /var aliases.
  const stage = yield* fs
    .makeTempDirectoryScoped({ prefix: "effect-auth-consumers-" })
    .pipe(Effect.flatMap((directory) => fs.realPath(directory)));

  const source = path.join(repositoryRoot, "packages/effect-auth");
  const destination = path.join(stage, "packages/effect-auth");

  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PublishManifest))(
    yield* fs.readFileString(path.join(source, "package.json")),
  );

  yield* fs.makeDirectory(destination, { recursive: true });
  yield* fs.copyFile(path.join(repositoryRoot, "package.json"), path.join(stage, "package.json"));
  yield* fs.copyFile(path.join(source, "package.json"), path.join(destination, "package.json"));
  yield* fs.copy(path.join(source, "dist"), path.join(destination, "dist"));
  yield* fs.copy(path.join(source, "test/packaging"), path.join(stage, "fixtures"));

  // Only required dependencies are installed. An accidental optional import must fail.
  for (const name of ["@yielded/auth", "effect", ...Object.keys(manifest.dependencies ?? {})]) {
    const link = path.join(stage, "node_modules", name);

    yield* fs.makeDirectory(path.dirname(link), { recursive: true });
    yield* fs.symlink(
      name === "@yielded/auth"
        ? destination
        : yield* fs.realPath(path.join(source, "node_modules", name)),
      link,
    );
  }

  yield* withPublishManifests(stage, () =>
    Effect.gen(function* () {
      yield* Effect.forEach(probes, (probe) => bundleConsumer(stage, probe), {
        concurrency: 2,
        discard: true,
      });

      const program = ts.createProgram(
        probes.map((probe) => path.join(stage, "fixtures", `${probe}.ts`)),
        {
          noEmit: true,
          strict: true,
          types: [],
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
      );

      // Check our declarations as well as the consumers. Third-party declaration
      // diagnostics belong to their owners (e.g. msgpackr assumes Node globals).
      const diagnostics = [
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program
          .getSourceFiles()
          .filter((file) => file.fileName.startsWith(`${stage}/`))
          .flatMap((file) => [
            ...program.getSyntacticDiagnostics(file),
            ...program.getSemanticDiagnostics(file),
          ]),
      ];

      if (diagnostics.length > 0)
        return yield* new PackageConsumerError({
          message: ts.formatDiagnostics(diagnostics, {
            getCanonicalFileName: (file) => file,
            getCurrentDirectory: () => stage,
            getNewLine: () => "\n",
          }),
        });

      // Native ESM must load without optional peers and expose exactly the direct module.
      // Execute separately so the repository's installed peers cannot mask missing imports.
      const child = yield* ChildProcess.make(
        "node",
        [
          "--input-type=module",
          "--eval",
          `import assert from "node:assert/strict";
const root = await import("@yielded/auth");
for (const [name, namespace] of Object.entries(root)) {
  const direct = await import("@yielded/auth/" + name);
  assert.strictEqual(namespace, direct, name + " must be a native module namespace");
}
const { Effect } = await import("effect");
assert.equal(await Effect.runPromise(root.Identity.stringSubjectId.toSubject("consumer")), "consumer");
const bundled = await import("./bundles/identity.mjs");
assert.equal(await Effect.runPromise(bundled.stringSubjectId.toSubject("bundled-consumer")), "bundled-consumer");
assert.ok(root.SessionContract.makeSessionContract);
console.log("Published native namespaces and bundled identity codec passed without optional peers.");`,
        ],
        { cwd: stage, stdout: "pipe", stderr: "pipe" },
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.mkString(Stream.decodeText(child.stderr)),
          child.exitCode,
        ],
        { concurrency: 3 },
      );

      if (code !== 0)
        return yield* new PackageConsumerError({
          message: `Published runtime consumer exited ${code}: ${stdout}${stderr}`,
        });
      yield* Console.log(stdout.trim());
    }),
  );
}, Effect.scoped);

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const script = yield* path.fromFileUrl(new URL(import.meta.url));

  yield* verifyPackageConsumers(path.resolve(path.dirname(script), ".."));
}).pipe(
  Effect.tapError((error) => Console.error(error.message)),
  Effect.provide(NodeServices.layer),
);

if (import.meta.main) NodeRuntime.runMain(program, { disableErrorReporting: true });
