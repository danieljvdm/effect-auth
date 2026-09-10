import { BunRuntime } from "@effect/platform-bun";
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Drizzle from "drizzle-orm/effect-sqlite-bun";
import { Effect } from "effect";
import { makeAuthServices } from "effect-auth/DrizzleSqliteBun";

import { mapping, verify } from "./drizzle-sqlite-node";

Effect.gen(function* () {
  const sql = yield* SqliteClient.SqliteClient;
  const db = yield* Drizzle.makeWithDefaults({});

  yield* verify("effect-sqlite-bun", sql, makeAuthServices(db, mapping));
}).pipe(
  Effect.provide(SqliteClient.layer({ filename: ":memory:" })),
  Effect.scoped,
  BunRuntime.runMain,
);
