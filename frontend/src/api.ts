import { useCallback, useEffect, useRef, useState } from "react";

export const base = "/library-dashboard";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const pendingWrites = new Set<Promise<unknown>>();
export function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const request = send();
  if (method !== "GET") {
    pendingWrites.add(request);
    void request.then(
      () => pendingWrites.delete(request),
      () => pendingWrites.delete(request),
    );
  }
  return request;
  async function send(): Promise<T> {
    // Read after our pending saves so navigation cannot restore an older checkbox state.
    if (method === "GET") await Promise.allSettled([...pendingWrites]);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") headers["X-CSRF-Token"] = csrf;
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    const data = await response
      .json()
      .catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
    if (!response.ok) {
      if (
        response.status === 401 &&
        !path.startsWith("/auth/") &&
        path !== "/me"
      ) {
        window.dispatchEvent(new Event("session-expired"));
      }
      throw new ApiError(
        data.error || "요청을 처리하지 못했습니다.",
        response.status,
      );
    }
    return data as T;
  }
}

export function useResource<T>(path: string) {
  const [state, setState] = useState<{
    path: string;
    data?: T;
    error?: string;
  }>({ path });
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const data = await api<T>(path, "GET", undefined, request.signal);
      if (!request.signal.aborted) setState({ path, data });
    } catch (error) {
      if (!request.signal.aborted)
        setState((old) => ({
          path,
          data: old.path === path ? old.data : undefined,
          error: message(error),
        }));
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);
  const update = useCallback(
    (change: (data: T) => T) => {
      controller.current?.abort();
      setState((old) =>
        old.path === path && old.data !== undefined
          ? { path, data: change(old.data) }
          : old,
      );
    },
    [path],
  );
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : undefined,
    refresh,
    update,
  };
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : "연결을 확인해주세요.";
}
