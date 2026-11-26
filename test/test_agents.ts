import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_MODES, claudeCommand, isAuthMode, type AgentOptions } from "../src/agents.js";
import { ARMS } from "../src/arms.js";

const options = (auth: AgentOptions["auth"]): AgentOptions => ({
  arm: ARMS.ts,
  stage: 1,
  tree: "/tmp/tree",
  logDir: "/tmp/log",
  model: "claude-sonnet-5-5",
  timeoutMs: 1,
  budgetUsd: 1,
  auth,
});

describe("claudeCommand", () => {
  it("isolates the run with --bare for an API key and --safe-mode for a subscription", () => {
    assert.ok(claudeCommand(options("api-key")).includes("--bare"));
    assert.ok(!claudeCommand(options("api-key")).includes("--safe-mode"));
    assert.ok(claudeCommand(options("subscription")).includes("--safe-mode"));
    assert.ok(!claudeCommand(options("subscription")).includes("--bare"));
  });
  it("differs between auth modes only in the isolation flag", () => {
    const withoutIsolation = (auth: AgentOptions["auth"]): string[] =>
      claudeCommand(options(auth)).filter((part) => part !== "--bare" && part !== "--safe-mode");
    assert.deepEqual(withoutIsolation("api-key"), withoutIsolation("subscription"));
  });
});

describe("isAuthMode", () => {
  it("accepts every auth mode and rejects anything else", () => {
    AUTH_MODES.forEach((auth) => assert.ok(isAuthMode(auth)));
    ["", "apikey", "Subscription", "oauth"].forEach((text) => assert.ok(!isAuthMode(text), text));
  });
});
