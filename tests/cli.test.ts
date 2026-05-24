import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/example/cli.js";

test("parseArgs extracts to text and context options", () => {
  const options = parseArgs([
    "send",
    "--to",
    "clawbot",
    "--text",
    "helloworld",
    "--context",
    "ctx-1",
  ]);

  assert.deepEqual(options, {
    command: "send",
    to: "clawbot",
    text: "helloworld",
    context: "ctx-1",
  });
});
