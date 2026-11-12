import { GoogleCalendarSettings } from "./GoogleCalendarSettings";
import { useState } from "react";
import { Check, SignOut, User, Timer } from "@phosphor-icons/react";
import { Heading } from "../../components/Shared";
import type { Availability, BusyPeriod, Preferences, StudyWindow } from "../../data/state";
import { BusySettings, PasswordSettings, WindowsSettings } from "./AvailabilitySettings";
import { browserNotificationsSupported, enableBrowserNotifications } from "../../lib/browserNotifications";
export function SettingsPage({
  email,
  preferences,
  availability,
  onSave,
  onSaveWindows,
  onAddBusy,
  onRemoveBusy,
  onChangePassword,
  onSignOut,
}: {
  email: string;
  preferences: Preferences;
  availability: Availability;
  onSave: (p: Preferences) => Promise<boolean>;
  onSaveWindows: (windows: StudyWindow[], version: number) => Promise<boolean>;
  onAddBusy: (busy: Omit<BusyPeriod, "id">) => Promise<boolean>;
  onRemoveBusy: (id: string) => void;
  onChangePassword: (current: string, next: string) => Promise<boolean>;
  onSignOut: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  return (
    <>
      <Heading
        eyebrow="MỘT NHỊP HỌC RẤT RIÊNG"
        title="Theo cách bạn muốn."
        description="Điều chỉnh những điều nhỏ để việc học thoải mái hơn."
      />
      <form
        className="settings-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave(draft);
          setSaving(false);
        }}
      >
        <section>
          <div className="settings-section-title">
            <User size={23} />
            <div>
              <h2>Thông tin của bạn</h2>
              <p>Một lời chào đúng tên, mỗi ngày.</p>
            </div>
          </div>
          <label>
            Tên hiển thị
            <input
              required
              maxLength={30}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Email đăng nhập
            <input readOnly value={email} />
          </label>
          <label>
            Múi giờ
            <input readOnly value="Việt Nam · Asia/Ho_Chi_Minh (GMT+7)" />
          </label>
        </section>
        <section>
          <div className="settings-section-title">
            <Timer size={23} />
            <div>
              <h2>Nhịp học và nghỉ ngơi</h2>
              <p>Áp dụng cho phiên tập trung mới và mô phỏng tiếp theo.</p>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Phiên tập trung (phút)
              <select
                value={draft.session}
                onChange={(e) =>
                  setDraft({ ...draft, session: Number(e.target.value) })
                }
              >
                {[25, 45, 50, 60].map((v) => (
                  <option key={v} value={v}>
                    {v} phút
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nghỉ giữa phiên (phút)
              <select
                value={draft.rest}
                onChange={(e) =>
                  setDraft({ ...draft, rest: Number(e.target.value) })
                }
              >
                {[5, 10, 15].map((v) => (
                  <option key={v} value={v}>
                    {v} phút
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Giới hạn tự học mỗi ngày
            <select
              value={draft.limit}
              onChange={(e) =>
                setDraft({ ...draft, limit: Number(e.target.value) })
              }
            >
              {[120, 180, 240, 300, 360].map((v) => (
                <option key={v} value={v}>
                  {v / 60} giờ
                </option>
              ))}
            </select>
          </label>
          <label className="toggle-label">
            <span>
              <strong>Hiển thị lời nhắc</strong>
              <small>
                Nhắc deadline, số phiên trong ngày và 15 phút trước mỗi phiên học.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={draft.reminders}
              onChange={(e) =>
                setDraft({ ...draft, reminders: e.target.checked })
              }
            />
          </label>
          <BrowserNotificationSetting />
        </section>
        <div className="form-actions">
          <button className="button dark" type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu cài đặt"}
            <Check size={17} />
          </button>
        </div>
      </form>
      <GoogleCalendarSettings />
      <WindowsSettings
        key={availability.version}
        availability={availability}
        onSave={onSaveWindows}
      />
      <BusySettings busy={availability.busy} onAdd={onAddBusy} onRemove={onRemoveBusy} />
      <PasswordSettings onChange={onChangePassword} />
      <section className="reset-section">
        <div>
          <h3>Đăng xuất</h3>
          <p>Kết thúc phiên trên trình duyệt này. Dữ liệu vẫn được lưu trên máy chủ.</p>
        </div>
        <button className="button" onClick={onSignOut}>
          <SignOut size={17} />
          Đăng xuất
        </button>
      </section>
    </>
  );
}

/**
 * System notifications while the tab is in the background. They need the page
 * to be open in some tab: there is no push server or service worker.
 */
function BrowserNotificationSetting() {
  const supported = browserNotificationsSupported();
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  return (
    <div className="toggle-label">
      <span>
        <strong>Thông báo của trình duyệt</strong>
        <small>
          {!supported
            ? "Trình duyệt này không hỗ trợ thông báo."
            : permission === "granted"
              ? "Đã bật. Lời nhắc hiện ra cả khi bạn đang ở tab khác (cần mở StudyBalance trong một tab)."
              : permission === "denied"
                ? "Đã bị chặn. Mở quyền thông báo cho trang này trong cài đặt trình duyệt."
                : "Hiện lời nhắc cả khi bạn đang ở tab khác."}
        </small>
      </span>
      {supported && permission === "default" && (
        <button
          type="button"
          className="button"
          onClick={async () => {
            await enableBrowserNotifications();
            setPermission(Notification.permission);
          }}
        >
          Bật thông báo
        </button>
      )}
    </div>
  );
}
