import { describe, expect, it, vi } from "vitest";
import { BackendError, call, on, toBackendError } from "./backend";
import { mockService, mockTopic, setMockLatency } from "./mock";

setMockLatency(0);

describe("backend (mock mode)", () => {
  it("routes calls to mocks", async () => {
    mockService("test", { echo: (a: { x: number }) => ({ y: a.x * 2 }) });
    await expect(call("test", "echo", { x: 21 })).resolves.toEqual({ y: 42 });
  });

  it("turns 'code: message' rejections into BackendError", async () => {
    mockService("test", {
      fail: () => {
        throw "offline: no network";
      },
    });
    const err = (await call("test", "fail").catch((e) => e)) as BackendError;
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe("offline");
    expect(err.message).toBe("no network");
    await expect(call("test", "missing")).rejects.toMatchObject({ code: "unknown_method" });
    expect(toBackendError("weird").code).toBe("unknown");
  });

  it("ref-counts topics: one source while any listener remains", async () => {
    const started = vi.fn();
    const stopped = vi.fn();
    mockTopic("test", "tick", {
      start: (emit) => {
        started();
        emit(1);
        return stopped;
      },
    });
    const a = vi.fn();
    const b = vi.fn();
    const offA = on("test", "tick", a);
    const offB = on("test", "tick", b);
    expect(started).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // the first value is replayed to listeners on a microtask
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(1);
    offA();
    await Promise.resolve();
    expect(stopped).not.toHaveBeenCalled();
    offB();
    await Promise.resolve(); // teardown runs after the subscription promise settles
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});
