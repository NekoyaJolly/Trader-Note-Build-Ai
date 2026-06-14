/**
 * Web Push 通知フックの副作用テスト
 *
 * サーバー登録失敗時にブラウザ側の購読だけが残らないことを確認する。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/apiClient";
import { usePushNotification } from "@/lib/usePushNotification";

vi.mock("@/lib/apiClient", () => ({
  apiRequest: vi.fn(),
}));

class MockPushSubscription implements PushSubscription {
  readonly endpoint = "https://push.example/subscriptions/rollback-test";
  readonly expirationTime = null;
  readonly options: PushSubscriptionOptions = {
    applicationServerKey: null,
    userVisibleOnly: true,
  };
  readonly unsubscribe = vi.fn(async (): Promise<boolean> => true);

  getKey(_name: PushEncryptionKeyName): ArrayBuffer {
    const buffer = new ArrayBuffer(3);
    const view = new Uint8Array(buffer);
    view.set([1, 2, 3]);
    return buffer;
  }

  toJSON(): PushSubscriptionJSON {
    return {
      endpoint: this.endpoint,
      expirationTime: this.expirationTime,
      keys: {
        p256dh: "AQID",
        auth: "AQID",
      },
    };
  }
}

function installPushEnvironment(subscription: PushSubscription): void {
  const subscribeMock = vi.fn(async (): Promise<PushSubscription> => subscription);
  const getSubscriptionMock = vi.fn(async (): Promise<PushSubscription | null> => null);
  const permissionStateMock = vi.fn(async (): Promise<PermissionState> => "granted");
  const pushManager: Pick<PushManager, "subscribe" | "getSubscription" | "permissionState"> = {
    subscribe: subscribeMock,
    getSubscription: getSubscriptionMock,
    permissionState: permissionStateMock,
  };
  const registration = {
    pushManager,
  };

  const serviceWorker = {
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    ready: Promise.resolve(registration),
  };

  const notificationApi = {
    permission: "granted" as NotificationPermission,
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => "granted"),
  };

  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManagerMock() {},
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorker,
  });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: notificationApi,
  });
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: notificationApi,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePushNotification", () => {
  it("サーバー登録に失敗した購読をブラウザ側でロールバックする", async () => {
    const subscription = new MockPushSubscription();
    installPushEnvironment(subscription);

    vi.mocked(apiRequest).mockImplementation(
      async <T,>(input: RequestInfo | URL): Promise<T> => {
        const endpoint = typeof input === "string" ? input : input.toString();

        if (endpoint === "/api/push/status") {
          return {
            success: true,
            data: {
              enabled: true,
              hasVapidKey: true,
            },
          } as T;
        }

        if (endpoint === "/api/push/vapid-public-key") {
          return {
            success: true,
            data: {
              publicKey: "AQID",
            },
          } as T;
        }

        if (endpoint === "/api/push/subscribe") {
          throw new Error("サーバー登録失敗");
        }

        throw new Error(`想定外の API 呼び出しです: ${endpoint}`);
      }
    );

    const { result } = renderHook(() => usePushNotification());

    await waitFor(() => {
      expect(result.current.serverStatus).toEqual({
        enabled: true,
        hasVapidKey: true,
      });
    });

    await act(async () => {
      const subscribed = await result.current.subscribe();
      expect(subscribed).toBe(false);
    });

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.error).toBe("サーバー登録失敗");
  });
});
