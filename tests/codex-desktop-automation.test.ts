import test from "node:test";
import assert from "node:assert/strict";
import { parseCodexDesktopAutomationArgs } from "../src/example/codex-desktop-automation/cli.js";

test("parseCodexDesktopAutomationArgs extracts content, script path, and python", () => {
  const options = parseCodexDesktopAutomationArgs([
    "--content",
    "hello codex",
    "--script-path",
    "C:\\tool\\skill_cli.py",
    "--python",
    "python3.13",
  ]);

  assert.deepEqual(options, {
    content: "hello codex",
    scriptPath: "C:\\tool\\skill_cli.py",
    pythonCommand: "python3.13",
  });
});
