import { describe, expect, it } from "vitest";
import { intentFor } from "./logic";

describe("search box", () => {
  it("opens paths", () => {
    expect(intentFor("C:\\Users", "google")?.kind).toBe("path");
    expect(intentFor("d:", "google")?.kind).toBe("path");
    expect(intentFor("%APPDATA%\\Code", "google")?.kind).toBe("path");
    expect(intentFor("\\\\nas\\share", "google")?.kind).toBe("path");
    expect(intentFor("~/Downloads", "google")?.kind).toBe("path");
  });
  it("opens sites and searches the rest", () => {
    expect(intentFor("github.com/tauri-apps", "google")).toEqual({ kind: "url", target: "https://github.com/tauri-apps" });
    const s = intentFor("weather in paris", "duckduckgo");
    expect(s?.kind).toBe("search");
    expect(s?.target).toBe("https://duckduckgo.com/?q=weather%20in%20paris");
  });
});
