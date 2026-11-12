/**
 * HTTP client for the StudyBalance services behind the gateway (/api/<service>).
 * The access token lives in memory only; the refresh token is an HttpOnly
 * cookie scoped to /api/user/auth, so a reload restores the session via refresh().
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (handler: () => void) => {
  onSignedOut = handler;
};
export const setAccessToken = (token: string) => {
  accessToken = token;
};

const CLIENT_HEADER = { "x-studybalance-client": "web" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Network error");
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. gateway error page): keep data null.
  }
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, error?.code ?? `HTTP_${res.status}`, error?.message ?? res.statusText);
  }
  return data;
}

interface SessionResponse {
  accessToken: string;
  user: Profile;
}
/** Single-flight refresh: concurrent 401s share one refresh call (tokens rotate on use). */
export function refresh(): Promise<boolean> {
  refreshing ??= send("POST", "/api/user/auth/refresh", undefined, CLIENT_HEADER)
    .then((data) => {
      accessToken = (data as SessionResponse).accessToken;
      return true;
    })
    .catch(() => {
      accessToken = null;
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await send(method, path, body)) as T;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401 && attempt === 0) {
        if (await refresh()) continue;
        onSignedOut();
      }
      // Planning learns about new tasks through events; give it a moment.
      if (error.code === "TASK_NOT_SYNCED" && attempt < 8) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Opens a long-lived GET (server-sent events) with the current access token.
 * EventSource cannot send an Authorization header, so streams use fetch.
 */
export async function openStream(path: string, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        accept: "text/event-stream",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    if (res.status === 401 && attempt === 0 && (await refresh())) continue;
    if (!res.ok || !res.body) throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText);
    return res;
  }
}

export interface Profile {
  id: string;
  email: string;
  name: string;
  role?: string;
  note: string;
  version: number;
  preferences: {
    sessionMinutes: number;
    restMinutes: number;
    dailyLimitMinutes: number;
    reminders: boolean;
    timezone: string;
  };
}
async function startSession(path: string, body: unknown) {
  const data = (await send("POST", path, body)) as SessionResponse;
  accessToken = data.accessToken;
  return data.user;
}
export const auth = {
  login: (email: string, password: string) => startSession("/api/user/auth/login", { email, password }),
  register: (name: string, email: string, password: string) =>
    startSession("/api/user/auth/register", { name, email, password }),
  googleConfig: () => api<{ configured: boolean; clientId: string | null }>("GET", "/api/user/auth/google/config"),
  googleLogin: (idToken: string) => startSession("/api/user/auth/google", { idToken }),
  /** Restores a session from the refresh cookie after a page load. */
  restore: async () => (await refresh()) && Boolean(accessToken),
  logout: async () => {
    await send("POST", "/api/user/auth/logout", undefined, CLIENT_HEADER).catch(() => undefined);
    accessToken = null;
  },
};

const messages: Record<string, string> = {
  INVALID_GOOGLE_TOKEN: "Xác thực tài khoản Google không thành công. Hãy thử lại.",
  NETWORK_ERROR: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  INVALID_CREDENTIALS: "Email hoặc mật khẩu chưa đúng.",
  EMAIL_TAKEN: "Email này đã được đăng ký.",
  TOO_MANY_ATTEMPTS: "Bạn đã thử sai quá nhiều lần. Vui lòng thử lại sau ít phút.",
  VALIDATION_ERROR: "Thông tin chưa hợp lệ. Hãy kiểm tra lại.",
  UNAUTHENTICATED: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.",
  NOT_FOUND: "Không tìm thấy dữ liệu. Có thể nó vừa bị xóa.",
  VERSION_CONFLICT: "Dữ liệu vừa được thay đổi ở nơi khác. Đã tải lại bản mới nhất.",
  TASK_NOT_SYNCED: "Công việc đang được đồng bộ. Thử lại sau giây lát.",
  SESSION_DONE: "Phiên này đã học xong nên không thể đổi.",
  TASK_DONE: "Công việc này đã hoàn thành.",
  INVALID_DURATION: "Thời lượng phải từ 5 phút và không vượt phần còn lại chưa xếp.",
  PAST_DATE: "Không thể xếp phiên vào ngày đã qua.",
  PAST_TIME: "Giờ bắt đầu đã qua. Hãy chọn một giờ muộn hơn.",
  AFTER_DEADLINE: "Phiên này nằm sau deadline của công việc.",
  DAILY_LIMIT: "Phiên mới sẽ vượt giới hạn tự học trong ngày.",
  OVERLAP: "Khoảng giờ này trùng phiên khác hoặc chưa đủ thời gian nghỉ.",
  SIMULATION_STALE: "Lịch đã thay đổi sau khi xem trước. Hãy xem lại phương án mới.",
  SIMULATION_INFEASIBLE: "Phương án còn phiên chưa xếp được nên chưa thể áp dụng.",
  PLAN_STALE: "Công việc hoặc lịch đã thay đổi sau khi đề xuất. Hãy tạo đề xuất mới.",
  OUTSIDE_AVAILABILITY: "Ngoài khung giờ học của bạn. Xem lại Lịch rảnh trong Cài đặt.",
  BUSY_PERIOD: "Khoảng giờ này trùng lịch bận bạn đã khai báo.",
  WRONG_PASSWORD: "Mật khẩu hiện tại chưa đúng.",
};
/** User-facing Vietnamese message for any thrown error. */
export const messageFor = (error: unknown) =>
  (error instanceof ApiError && messages[error.code]) || "Đã có lỗi xảy ra. Vui lòng thử lại.";
