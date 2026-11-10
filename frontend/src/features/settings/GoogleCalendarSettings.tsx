import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsClockwise, CalendarBlank, LinkBreak, ArrowUpRight } from "@phosphor-icons/react";
import { api, ApiError, messageFor } from "../../lib/api";
import { Modal } from "../../components/Shared";

interface GoogleStatus {
  configured: boolean; connected: boolean; email: string | null; calendarId: string | null;
  selectedCalendarIds: string[]; lastSyncAt: string | null; errorCode: string | null;
  conflicts: number; syncDays: number;
}
interface GoogleCalendar { id: string; name: string; primary: boolean }
const base = "/api/user/integrations/google";
const messages: Record<string, string> = {
  GOOGLE_NOT_CONFIGURED: "Kết nối Google Calendar chưa được cấu hình trên máy chủ.",
  GOOGLE_RECONNECT: "Google yêu cầu cấp quyền lại. Hãy kết nối lại tài khoản.",
  GOOGLE_SYNC_BUSY: "Một lần đồng bộ đang chạy. Hãy chờ một chút rồi thử lại.",
  GOOGLE_BUSY_UNAVAILABLE: "Không đọc được một lịch đã chọn. Dữ liệu bận cũ vẫn được giữ; hãy kiểm tra quyền truy cập hoặc chọn lại lịch.",
  GOOGLE_SOURCE_UNAVAILABLE: "Chưa đọc được lịch học hiện tại. Hãy thử đồng bộ lại sau.",
};
const googleMessage = (error: unknown) => error instanceof ApiError
  ? messages[error.code] ?? (error.code.startsWith("GOOGLE_") ? "Chưa đồng bộ được với Google. Dữ liệu đã lưu được giữ lại; hãy thử lại." : messageFor(error))
  : messageFor(error);
const callbackMessages: Record<string, string> = {
  connected: "Đã kết nối Google Calendar. Chọn lịch cần đọc hoặc bấm Đồng bộ ngay để bắt đầu.",
  denied: "Bạn chưa cấp quyền kết nối. Lịch trong StudyBalance vẫn được giữ nguyên.",
  missing_scope: "Chưa cấp đủ quyền cần thiết. Hãy kết nối lại và cho phép các quyền lịch được yêu cầu.",
  invalid_state: "Yêu cầu kết nối đã hết hạn hoặc được mở ở trình duyệt khác. Hãy kết nối lại.",
  failed: "Chưa hoàn tất kết nối Google. Hãy thử lại.",
};

export function GoogleCalendarSettings() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(() => callbackMessages[new URLSearchParams(location.search).get("google_calendar") ?? ""] ?? "");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const status = useQuery({ queryKey: ["google-calendar-status"], queryFn: () => api<GoogleStatus>("GET", `${base}/status`), refetchInterval: 60_000 });
  const data = status.data;
  const calendars = useQuery({ queryKey: ["google-calendars", data?.email], queryFn: () => api<{ items: GoogleCalendar[] }>("GET", `${base}/calendars`), enabled: !!data?.connected && !!data.configured, retry: false });
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has("google_calendar")) {
      url.searchParams.delete("google_calendar");
      history.replaceState(null, "", url);
    }
  }, []);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["google-calendar-status"] }),
      client.invalidateQueries({ queryKey: ["google-calendars"] }),
      client.invalidateQueries({ queryKey: ["availability"] }),
    ]);
  };
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (err) { setError(googleMessage(err)); }
    finally { await refresh(); lock.current = false; setBusy(false); }
  };
  const connect = () => void run(async () => {
    const result = await api<{ url: string }>("POST", `${base}/connect`);
    window.location.assign(result.url);
  });
  const chosen = draft ?? data?.selectedCalendarIds ?? [];
  const isChosen = (calendar: GoogleCalendar) => chosen.includes(calendar.id) || (calendar.primary && chosen.includes("primary"));
  return (
    <section className="google-calendar-settings" aria-labelledby="google-calendar-title" aria-busy={busy || status.isPending}>
      <div className="settings-section-title">
        <CalendarBlank size={25} />
        <div><h2 id="google-calendar-title">Google Calendar</h2><p>Lịch học và lịch cá nhân, cùng một nhịp.</p></div>
      </div>
      <p>Lấy giờ bận từ những lịch bạn chọn để tránh xếp trùng. Phiên học được đưa vào lịch Google riêng tên StudyBalance.</p>
      <p className="google-calendar-help">Tự đồng bộ mỗi 5 phút cho 60 ngày sắp tới khi máy chủ hoạt động. Chỉnh sửa phiên học tại StudyBalance; thay đổi trên Google không được nhập ngược vào phiên học.</p>
      {status.isPending && <p role="status">Đang kiểm tra kết nối…</p>}
      {status.error && <p className="form-error" role="alert">{googleMessage(status.error)} <button className="text-button" onClick={() => void status.refetch()}>Thử lại</button></p>}
      {data && !data.configured && <p className="google-calendar-notice">Tính năng đang chờ cấu hình kết nối Google trên máy chủ. Lịch học hiện tại vẫn sử dụng bình thường.</p>}
      {data?.connected && (
        <>
          <div className="google-calendar-account"><span className="badge green">Đã kết nối</span><strong>{data.email}</strong></div>
          <p className="google-calendar-help">{data.lastSyncAt ? `Đồng bộ thành công gần nhất: ${new Date(data.lastSyncAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} (GMT+7)` : "Chưa có lần đồng bộ thành công."}</p>
          {data.errorCode && <p className="form-error" role="alert">{googleMessage(new ApiError(502, data.errorCode, ""))}</p>}
          {data.conflicts > 0 && <p className="google-calendar-notice" role="status">Có {data.conflicts} phiên học trùng giờ bận Google ở lần kiểm tra gần nhất. Vào “Thử thay đổi” để chủ động dời lịch.</p>}
          {calendars.isPending && <p>Đang lấy danh sách lịch…</p>}
          {calendars.error && <p className="form-error" role="alert">{googleMessage(calendars.error)}</p>}
          {calendars.data && (
            <fieldset className="google-calendar-choices" disabled={busy}>
              <legend>Lấy giờ bận từ những lịch nào?</legend>
              {calendars.data.items.map((calendar) => (
                <label key={calendar.id}>
                  <input type="checkbox" checked={isChosen(calendar)} onChange={(e) => {
                    const current = calendars.data.items.filter(isChosen).map((item) => item.id);
                    setDraft(e.target.checked ? [...current, calendar.id] : current.filter((id) => id !== calendar.id));
                  }} />
                  <span>{calendar.name}{calendar.primary ? " · Lịch chính" : ""}</span>
                </label>
              ))}
              <small>Bỏ chọn tất cả nếu chỉ muốn đưa phiên học lên Google. Tên sự kiện và khung giờ bận được hiển thị trên lịch tuần StudyBalance.</small>
              <button className="button" disabled={busy || draft === null} onClick={() => void run(async () => {
                await api("PUT", `${base}/calendars`, { ids: draft });
                setDraft(null); setNotice("Đã lưu lựa chọn và đồng bộ lịch.");
              })}>Lưu lựa chọn và đồng bộ</button>
            </fieldset>
          )}
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="google-calendar-notice" role="status">{notice}</p>}
      <div className="google-calendar-actions">
        {data?.configured && (!data.connected || data.errorCode === "GOOGLE_RECONNECT") && <button className="button dark" disabled={busy} onClick={connect}>{busy ? "Đang mở Google…" : data.connected ? "Kết nối lại Google Calendar" : "Kết nối Google Calendar"}<ArrowUpRight size={17} /></button>}
        {data?.connected && <>
          <button className="button dark" disabled={busy || !data.configured} onClick={() => void run(async () => {
            await api("POST", `${base}/sync`); setNotice("Đã đồng bộ giờ bận và phiên học.");
          })}><ArrowsClockwise size={17} />{busy ? "Đang xử lý…" : "Đồng bộ ngay"}</button>
          <button className="button" disabled={busy} onClick={connect} title="Đăng nhập lại Google để cấp quyền đọc tên sự kiện"><ArrowUpRight size={17} />Cấp quyền đọc tên sự kiện</button>
          <button className="button" disabled={busy} onClick={() => setConfirmDisconnect(true)}><LinkBreak size={17} />Ngắt kết nối</button>
        </>}
      </div>
      {confirmDisconnect && <Modal title="Ngắt kết nối Google Calendar?" onClose={() => { if (!lock.current) setConfirmDisconnect(false); }}>
        <p className="modal-intro">App sẽ ngừng đồng bộ và bỏ các khoảng bận lấy từ Google. Công việc, phiên học trong StudyBalance và các sự kiện đã xuất lên Google vẫn được giữ.</p>
        <div className="form-actions">
          <button className="button" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Giữ kết nối</button>
          <button className="button dark" disabled={busy} onClick={() => void run(async () => {
            const result = await api<{ revoked: boolean }>("POST", `${base}/disconnect`);
            setConfirmDisconnect(false); setDraft(null);
            setNotice(result.revoked ? "Đã ngắt kết nối Google Calendar." : "Đã ngắt kết nối trong app. Chưa thu hồi được quyền phía Google; bạn có thể gỡ StudyBalance trong phần bảo mật tài khoản Google.");
          })}>{busy ? "Đang ngắt…" : "Ngắt kết nối"}</button>
        </div>
      </Modal>}
    </section>
  );
}
