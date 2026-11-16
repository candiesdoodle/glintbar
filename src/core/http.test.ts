import { describe, expect, it } from "vitest";
import { HttpError, redactUrls, toHttpError } from "./http";
import { BackendError } from "./backend";

describe("redactUrls", () => {
  it("keeps only the host of every address", () => {
    expect(redactUrls("error sending request for url (https://calendar.example.com/private/abc123/basic.ics?key=s3cret)")).toBe(
      "error sending request for url (calendar.example.com)",
    );
    expect(redactUrls("webcal://p01-caldav.icloud.com/published/2/XYZ failed")).toBe("p01-caldav.icloud.com failed");
    expect(redactUrls("https://user:pw@api.example.com:8443/x")).toBe("api.example.com");
  });

  it("is applied to error details", () => {
    expect(new HttpError("server", 500, "GET https://x.test/a?token=1").detail).toBe("GET x.test");
    expect(toHttpError(new BackendError("http", "error for url (https://h.test/p?k=v)")).detail).toBe("error for url (h.test)");
  });
});
