import { useState } from "react";
import { CalendarX, Check, Clock, Key, Plus, Trash, X } from "@phosphor-icons/react";
import { WEEKDAYS, duration, time, type Availability, type BusyPeriod, type StudyWindow } from "../../data/state";
import { fullDate, todayISO, weekdayName } from "../../data/dates";

/** "HH:MM" ↔ minutes; an end time of 23:59 means the end of the day (24:00). */
const toMinute = (value: string, end = false) => {
  const [h, m] = value.split(":").map(Number);
  const minute = h * 60 + m;
  return end && minute === 1439 ? 1440 : minute;
};
const toInput = (minute: number) => (minute >= 1440 ? "23:59" : time(minute));

function checkWindows(windows: StudyWindow[]) {
  for (let day = 0; day < 7; day++) {
    const list = windows.filter((w) => w.weekday === day).sort((a, b) => a.startMinute - b.startMinute);
    for (const w of list)
      if (w.startMinute >= w.endMinute) return `${WEEKDAYS[day]}: giờ kết thúc phải sau giờ bắt đầu.`;
    for (let i = 1; i < list.length; i++)
      if (list[i].startMinute < list[i - 1].endMinute) return `${WEEKDAYS[day]}: các khung giờ đang chồng lên nhau.`;
    if (list.length > 6) return `${WEEKDAYS[day]}: tối đa 6 khung giờ.`;
  }
  return null;
}

/** Weekly study windows. Sessions, suggestions and simulations only use these times. */
export function WindowsSettings({
  availability,
  onSave,
}: {
  availability: Availability;
  onSave: (windows: StudyWindow[], version: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(availability.windows);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (index: number, change: Partial<StudyWindow>) =>
    setDraft(draft.map((w, i) => (i === index ? { ...w, ...change } : w)));
  const total = (day: number) =>
    draft.filter((w) => w.weekday === day).reduce((n, w) => n + Math.max(0, w.endMinute - w.startMinute), 0);
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const problem = checkWindows(draft);
        setError(problem ?? "");
        if (problem) return;
        setSaving(true);
        await onSave(draft, availability.version);
        setSaving(false);
      }}
    >
      <section>
        <div className="settings-section-title">
          <Clock size={23} />
          <div>
            <h2>Lịch rảnh trong tuần</h2>
            <p>Phiên học, gợi ý lịch và mô phỏng chỉ dùng những khung giờ này.</p>
          </div>
        </div>
        <div className="week-windows">
          {WEEKDAYS.map((label, day) => {
            const rows = draft.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === day);
            return (
              <div className="weekday-row" key={day}>
                <div className="weekday-name">
                  <strong>{label}</strong>
                  <small>{rows.length ? duration(total(day)) : "Nghỉ"}</small>
                </div>
                <div className="weekday-windows">
                  {rows.map(({ w, i }) => (
                    <div className="window-row" key={i}>
                      <input
                        type="time"
                        aria-label={`${label}: bắt đầu`}
                        value={toInput(w.startMinute)}
                        onChange={(e) => update(i, { startMinute: toMinute(e.target.value) })}
                      />
                      <span>–</span>
                      <input
                        type="time"
                        aria-label={`${label}: kết thúc`}
                        value={toInput(w.endMinute)}
                        onChange={(e) => update(i, { endMinute: toMinute(e.target.value, true) })}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Bỏ khung giờ ${label}`}
                        onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      const last = rows.at(-1)?.w.endMinute ?? 480;
                      const start = Math.min(last + (rows.length ? 60 : 0), 1380);
                      setDraft([...draft, { weekday: day, startMinute: start, endMinute: Math.min(start + 120, 1440) }]);
                    }}
                  >
                    <Plus size={14} />
                    Thêm khung giờ
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            setDraft(
              Array.from({ length: 7 }, (_, weekday) =>
                draft.filter((w) => w.weekday === 0).map((w) => ({ ...w, weekday })),
              ).flat(),
            )
          }
        >
          Dùng khung giờ Thứ Hai cho mọi ngày
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="form-actions">
        <button className="button dark" type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Lưu lịch rảnh"}
          <Check size={17} />
        </button>
      </div>
    </form>
  );
}

/** One-off busy periods and days off. */
export function BusySettings({
  busy,
  onAdd,
  onRemove,
}: {
  busy: BusyPeriod[];
  onAdd: (busy: Omit<BusyPeriod, "id">) => Promise<boolean>;
  onRemove: (id: string) => void;
}) {
  const today = todayISO();
  const [form, setForm] = useState({ date: today, allDay: true, from: "13:00", to: "17:00", label: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const upcoming = busy.filter((b) => b.date >= today);
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const startMinute = form.allDay ? 0 : toMinute(form.from);
        const endMinute = form.allDay ? 1440 : toMinute(form.to, true);
        if (startMinute >= endMinute) {
          setError("Giờ kết thúc phải sau giờ bắt đầu.");
          return;
        }
        setError("");
        setSaving(true);
        if (await onAdd({ date: form.date, startMinute, endMinute, label: form.label.trim() }))
          setForm({ ...form, label: "" });
        setSaving(false);
      }}
    >
      <section>
        <div className="settings-section-title">
          <CalendarX size={23} />
          <div>
            <h2>Lịch bận và ngày nghỉ</h2>
            <p>Những khoảng này được bỏ qua khi xếp phiên. Phiên đã có trong lịch không tự dời; dùng “Thử thay đổi” để dời.</p>
          </div>
        </div>
        {upcoming.length ? (
          <ul className="busy-list">
            {upcoming.map((b) => (
              <li key={b.id}>
                <span>
                  <strong>
                    {weekdayName(b.date)}, {fullDate(b.date)}
                  </strong>
                  <small>
                    {b.startMinute === 0 && b.endMinute >= 1440
                      ? "Cả ngày"
                      : `${time(b.startMinute)} – ${b.endMinute >= 1440 ? "24:00" : time(b.endMinute)}`}
                    {b.label ? ` · ${b.label}` : ""}
                  </small>
                </span>
                {b.source === "google" ? <span className="badge blue">Google</span> : <button
                  type="button"
                  className="icon-button"
                  aria-label={`Xóa lịch bận ${fullDate(b.date)}`}
                  onClick={() => onRemove(b.id)}
                >
                  <Trash size={16} />
                </button>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="quiet-note">Chưa có lịch bận sắp tới.</p>
        )}
        <div className="form-grid">
          <label>
            Ngày
            <input
              type="date"
              required
              min={today}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label>
            Ghi chú
            <input
              maxLength={80}
              placeholder="Ví dụ: Đi làm thêm"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </label>
        </div>
        <label className="toggle-label">
          <span>
            <strong>Bận cả ngày</strong>
            <small>Ngày nghỉ, thi, về quê…</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={form.allDay}
            onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
          />
        </label>
        {!form.allDay && (
          <div className="form-grid">
            <label>
              Từ
              <input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
            </label>
            <label>
              Đến
              <input type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
            </label>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="form-actions">
        <button className="button" type="submit" disabled={saving}>
          <Plus size={17} />
          Thêm lịch bận
        </button>
      </div>
    </form>
  );
}

export function PasswordSettings({ onChange }: { onChange: (current: string, next: string) => Promise<boolean> }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (form.next !== form.confirm) {
          setError("Mật khẩu nhập lại chưa khớp.");
          return;
        }
        setError("");
        setSaving(true);
        if (await onChange(form.current, form.next)) setForm({ current: "", next: "", confirm: "" });
        setSaving(false);
      }}
    >
      <section>
        <div className="settings-section-title">
          <Key size={23} />
          <div>
            <h2>Đổi mật khẩu</h2>
            <p>Các thiết bị khác sẽ được đăng xuất.</p>
          </div>
        </div>
        <label>
          Mật khẩu hiện tại
          <input
            type="password"
            required
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Mật khẩu mới
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={form.next}
              onChange={(e) => setForm({ ...form, next: e.target.value })}
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="form-actions">
        <button className="button" type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
      </div>
    </form>
  );
}
