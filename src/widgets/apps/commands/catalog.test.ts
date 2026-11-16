import { describe, expect, it } from "vitest";
import { SAMPLE_APPS } from "../shared/sample";
import { findCommands } from "./catalog";

describe("commands", () => {
  it("finds apps and actions by a word", () => {
    const r = findCommands("term", SAMPLE_APPS);
    expect(r[0].kind).toBe("app");
    const lock = findCommands("lock", SAMPLE_APPS);
    expect(lock[0].kind === "command" && lock[0].command.id).toBe("lock");
    expect(findCommands("wifi", []).length).toBe(1);
    expect(findCommands("", SAMPLE_APPS)).toEqual([]);
  });
});
