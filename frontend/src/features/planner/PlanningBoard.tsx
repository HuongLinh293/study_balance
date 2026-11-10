import { useSave } from "../../hooks/useSave";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Clock,
  Check,
  Play,
  Sun,
  Coffee,
  LockSimple,
  CalendarBlank,
  PencilSimple,
  X,
  Tray,
  ArrowBendDownRight,
} from "@phosphor-icons/react";
import { Modal } from "../../components/Shared";
import {
  subjectFor,
  time,
  duration,
  dueLabel,
  type AppState,
  type Task,
  type Session,
} from "../../data/state";
import {
  busyOn,
  closedRanges,
  firstFreeStart,
  remainingToSchedule,
  validateTimebox,
  viewHours,
  windowsOn,
} from "../../data/schedule";
/** Pixels per hour on the day timeline. */
const HOUR = 64;
import {
  addDays,
  fullDate,
  minutesOfDay,
  parseISODate,
  shortDate,
  todayISO,
  weekdayName,
} from "../../data/dates";

interface Props {
  state: AppState;
  onAdd: () => void;
  onTask: (task: Task) => void;
  onSchedule: (session: Session) => Promise<boolean>;
  onRemove: (id: string) => void;
  onFocus: (session: Session) => void;
}
export function PlanningBoard({
  state,
  onAdd,
  onTask,
  onSchedule,
  onRemove,
  onFocus,
}: Props) {
  const [editing, setEditing] = useState<Session | null>(null);
  const [undoError, setUndoError] = useState("");
  const [removed, setRemoved] = useState<Session | null>(null);
  const today = todayISO();
  const boardDays = [today, addDays(today, 1), addDays(today, 2)];
  const [day, setDay] = useState(today);
  const [subject, setSubject] = useState("all");
  const [scheduling, setScheduling] = useState<Task | null>(null);
  const sessions = state.sessions
    .filter((s) => s.date === day)
    .sort((a, b) => a.start - b.start);
  const total = sessions.reduce((n, s) => n + s.minutes, 0);
  const pending = sessions.filter(
    (s) => !s.done && !state.tasks.find((t) => t.id === s.taskId)?.done,
  );
  const backlog = state.tasks.filter(
    (t) =>
      !t.done &&
      remainingToSchedule(state, t) > 0 &&
      (subject === "all" || t.subject === subject),
  );
  const remaining = Math.max(0, state.preferences.limit - total);
  const now = minutesOfDay();
  const view = viewHours(state.availability);
  const y = (minute: number) => ((minute - view.from * 60) / 60) * HOUR;
  const showNow = day === today && now >= view.from * 60 && now <= view.to * 60;
  return (
    <>
      <div className="planning-ritual">
        <div>
          <span className="ritual-number">01</span>Chọn việc quan trọng
        </div>
        <ArrowRight size={14} />
        <div>
          <span className="ritual-number">02</span>Dành đủ thời gian
        </div>
        <ArrowRight size={14} />
        <div>
          <span className="ritual-number">03</span>Bắt đầu nhẹ nhàng
        </div>
        <span className="ritual-note">
          Một kế hoạch thực tế, một ngày nhẹ hơn.
        </span>
      </div>
      {removed && (
        <div className="undo-session" role="status">
          Đã bỏ phiên khỏi lịch.
          <button
            className="text-button"
            onClick={() => {
              const task = state.tasks.find((t) => t.id === removed.taskId)!;
              const error = validateTimebox(
                state,
                task,
                removed.date,
                removed.start,
                removed.minutes,
              );
              if (error) {
                setUndoError(error);
                return;
              }
              // A fresh id: the removed session's id already carries a deletion tombstone.
              onSchedule({ ...removed, id: crypto.randomUUID(), version: 1 });
              setRemoved(null);
              setUndoError("");
            }}
          >
            Hoàn tác
          </button>
        </div>
      )}
      {undoError && (
        <p className="form-error" role="alert">
          {undoError}
        </p>
      )}
      <a
        className="mobile-plan-jump button"
        href="#planning-inbox"
        onClick={(e) => {
          e.preventDefault();
          document
            .getElementById("planning-inbox")
            ?.scrollIntoView({ behavior: "smooth" });
        }}
      >
        Xếp thêm việc ↓
      </a>
      <div className="planning-board">
        <section className="planning-inbox" id="planning-inbox">
          <div className="board-section-heading">
            <div>
              <Tray size={19} />
              <h2>Chưa xếp lịch</h2>
              <span className="count-pill">{backlog.length}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Thêm công việc chưa xếp lịch"
              onClick={onAdd}
            >
              <Plus size={18} />
            </button>
          </div>
          <p className="board-subtitle">Ghi ra khỏi đầu. Xếp vào một ngày.</p>
          <label className="board-subject-filter">
            <span>Môn học</span>
            <select
              aria-label="Lọc việc chưa xếp theo môn"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="all">Tất cả môn</option>
              {state.subjects.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.short}
                </option>
              ))}
            </select>
          </label>
          <div className="backlog-list">
            {backlog.map((t) => {
              const sub = subjectFor(state.subjects, t.subject);
              return (
                <article className="backlog-task" key={t.id}>
                  <div className="backlog-subject">
                    <i className={`subject-dot ${sub.color}`} />
                    {sub.short}
                  </div>
                  <button className="backlog-title" onClick={() => onTask(t)}>
                    {t.title}
                  </button>
                  <div className="backlog-meta">
                    <span>
                      <Clock size={12} />
                      {duration(remainingToSchedule(state, t))}
                    </span>
                    <span>Hạn {dueLabel(t.due)}</span>
                  </div>
                  <button
                    className="schedule-task-button"
                    onClick={() => setScheduling(t)}
                  >
                    Xếp vào ngày {shortDate(day)}
                    <ArrowRight size={14} />
                  </button>
                </article>
              );
            })}
            {!backlog.length && (
              <div className="inbox-empty">
                <span className="round-icon green">
                  <Check size={22} />
                </span>
                <h3>
                  {subject === "all"
                    ? state.tasks.length
                      ? "Mọi việc đã có chỗ."
                      : "Chưa có công việc nào."
                    : "Không có việc chưa xếp cho môn này."}
                </h3>
                <p>
                  {state.tasks.length
                    ? "Thêm việc mới hoặc bỏ một phiên khỏi lịch để sắp xếp lại."
                    : "Ghi lại việc cần làm, rồi xếp nó vào một ngày."}
                </p>
              </div>
            )}
          </div>
          <button className="board-add" onClick={onAdd}>
            <Plus size={17} />
            Ghi lại một công việc
          </button>
          <div className="inbox-tip">
            <ArrowBendDownRight size={19} />
            <p>
              Bắt đầu với 2–3 việc quan trọng. Bạn không cần lấp đầy cả ngày.
            </p>
          </div>
        </section>
        <section className="planning-day">
          <div className="board-day-tabs" aria-label="Chọn ngày lập kế hoạch">
            {boardDays.map((d, i) => (
              <button
                key={d}
                aria-pressed={day === d}
                className={day === d ? "active" : ""}
                onClick={() => setDay(d)}
              >
                <span>{["Hôm nay", "Ngày mai", weekdayName(d)][i]}</span>
                <strong>
                  {parseISODate(d).getDate()}
                  <small>/{parseISODate(d).getMonth() + 1}</small>
                </strong>
                <span className="day-tab-dot" />
              </button>
            ))}
          </div>
          <div className="planning-day-heading">
            <div>
              <span className="eyebrow">
                {weekdayName(day).toLocaleUpperCase("vi")} · THÁNG{" "}
                {parseISODate(day).getMonth() + 1},{" "}
                {parseISODate(day).getFullYear()}
              </span>
              <h2>
                {day === today
                  ? "Hôm nay, vừa đủ thôi."
                  : day === boardDays[1]
                    ? "Dành chỗ cho ngày mai."
                    : "Một ngày phía trước."}
              </h2>
            </div>
            <Sun size={29} weight="duotone" />
          </div>
          <div className="day-capacity">
            <div>
              <span>
                <Clock size={14} />
                Đã lên kế hoạch
              </span>
              <strong>
                {duration(total)}
                <small> / {duration(state.preferences.limit)}</small>
              </strong>
            </div>
            <div className="capacity-track">
              <span
                style={{
                  width: `${Math.min(100, (total / state.preferences.limit) * 100)}%`,
                }}
              />
            </div>
            <span className="capacity-caption">
              {remaining
                ? `Còn ${duration(remaining)} trong giới hạn tự học. Không cần dùng hết.`
                : "Ngày này đã đủ đầy. Hãy để thêm việc cho ngày khác."}
            </span>
          </div>
          <div className="day-task-list">
            {sessions.map((s) => {
              const t = state.tasks.find((t) => t.id === s.taskId)!;
              const sub = subjectFor(state.subjects, t.subject);
              return (
                <article
                  key={s.id}
                  className={`day-plan-task ${s.done || t.done ? "completed" : ""}`}
                >
                  <div className="day-task-top">
                    <span>
                      {time(s.start)} — {time(s.start + s.minutes)}
                    </span>
                    <span className="timebox-length">
                      {duration(s.minutes)}
                    </span>
                  </div>
                  <div className="day-task-title">
                    <span
                      className={`plan-check ${s.done ? "done" : sub.color}`}
                    >
                      {s.done ? <Check size={12} /> : <span />}
                    </span>
                    <button onClick={() => onTask(t)}>{t.title}</button>
                  </div>
                  <div className="day-task-bottom">
                    <span className={`badge ${sub.color}`}>{sub.short}</span>
                    <div>
                      {s.done || t.done ? (
                        <span className="session-complete">
                          {s.done ? "Phiên đã học" : "Công việc đã xong"}
                        </span>
                      ) : (
                        <>
                          <button
                            className="icon-button"
                            aria-label={`Bỏ phiên ${t.title} ngày ${shortDate(day)} lúc ${time(s.start)} khỏi lịch`}
                            title="Bỏ phiên khỏi lịch"
                            onClick={() => {
                              setUndoError("");
                              setRemoved(s);
                              onRemove(s.id);
                            }}
                          >
                            <X size={14} />
                          </button>
                          <button
                            className="plan-start"
                            onClick={() => setEditing(s)}
                          >
                            <PencilSimple size={14} />
                            Đổi lịch
                          </button>
                          {day === today && !t.done && (
                            <button
                              className="plan-start"
                              onClick={() => onFocus(s)}
                            >
                              <Play size={11} weight="fill" />
                              Tập trung
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
            {!sessions.length && (
              <div className="day-plan-empty">
                <CalendarBlank size={33} />
                <h3>Một trang mới đang chờ bạn.</h3>
                <p>
                  Chọn công việc trong mục “Chưa xếp lịch” bên dưới hoặc bên
                  cạnh để dành thời gian cho nó.
                </p>
              </div>
            )}
          </div>
          <div className="day-shutdown">
            <Coffee size={20} />
            <div>
              <strong>Và rồi, dành thời gian cho mình.</strong>
              <p>
                {pending.length
                  ? `${pending.length} phiên nữa, từng việc một thôi.`
                  : "Bạn có thể thảnh thơi với khoảng thời gian còn lại."}
              </p>
            </div>
          </div>
        </section>
        <aside className="planning-timeline">
          <div className="board-section-heading">
            <div>
              <CalendarBlank size={18} />
              <h2>Lịch ngày {shortDate(day)}</h2>
            </div>
            <span className="timezone">GMT+7</span>
          </div>
          <p className="board-subtitle">Mỗi việc, một khoảng thời gian.</p>
          <div className="timebox-scroll">
            <div className="timebox-canvas" style={{ height: view.hours * HOUR + 32 }}>
              {Array.from({ length: view.hours + 1 }, (_, i) => (
                <div className="hour-line" style={{ top: i * HOUR }} key={i}>
                  {/* The "now" marker carries its own label; hide an hour label it would cover. */}
                  <span
                    style={{
                      visibility:
                        showNow && Math.abs(now - (view.from + i) * 60) < 15 ? "hidden" : undefined,
                    }}
                  >
                    {String(view.from + i).padStart(2, "0")}:00
                  </span>
                  <i />
                </div>
              ))}
              {closedRanges(state.availability, day, view.from * 60, view.to * 60).map(([s, e]) => (
                <div
                  className="timebox-lunch closed"
                  key={`c${s}`}
                  style={{ top: y(s), height: ((e - s) / 60) * HOUR }}
                >
                  {e - s >= 40 && (
                    <span>
                      Ngoài giờ học
                      <small>
                        {time(s)} – {time(e)}
                      </small>
                    </span>
                  )}
                </div>
              ))}
              {busyOn(state.availability, day).map((b) => {
                const start = Math.max(b.startMinute, view.from * 60);
                const end = Math.min(b.endMinute, view.to * 60);
                if (end <= start) return null;
                return (
                  <div
                    className={b.source === "google" ? "timebox-lunch timebox-google" : "timebox-lunch"}
                    key={b.id}
                    style={{
                      top: y(start),
                      height: Math.max(20, ((end - start) / 60) * HOUR),
                    }}
                  >
                    <LockSimple size={13} />
                    <span>
                      {b.label || "Lịch bận"}
                      <small>
                        {time(b.startMinute)} – {b.endMinute >= 1440 ? "24:00" : time(b.endMinute)}
                      </small>
                    </span>
                  </div>
                );
              })}
              {sessions.map((s) => {
                const task = state.tasks.find((t) => t.id === s.taskId)!;
                return (
                  <button
                    key={s.id}
                    className={`timebox-event ${subjectFor(state.subjects, task.subject).color} ${s.done || task.done ? "done" : ""} ${s.minutes < 30 ? "short-event" : ""}`}
                    style={{
                      top: y(s.start),
                      height: (s.minutes / 60) * HOUR,
                    }}
                    aria-label={`${task.title}, ${time(s.start)}–${time(s.start + s.minutes)}${task.done ? ", công việc đã xong" : ""}`}
                    onClick={() =>
                      s.done || task.done ? onTask(task) : setEditing(s)
                    }
                  >
                    <strong>{task.title}</strong>
                    <span>
                      {time(s.start)} – {time(s.start + s.minutes)}
                    </span>
                  </button>
                );
              })}
              {showNow && (
                <div className="timebox-now" style={{ top: y(now) }}>
                  <span>{time(now)}</span>
                  <i />
                </div>
              )}
            </div>
          </div>
          <div className="timeline-footer">
            <span className="subject-dot green" />
            Khoảng trống cũng là một phần kế hoạch.
          </div>
        </aside>
      </div>
      {editing && (
        <ScheduleDialog
          state={state}
          task={state.tasks.find((t) => t.id === editing.taskId)!}
          day={editing.date}
          existing={editing}
          onClose={() => setEditing(null)}
          onSave={onSchedule}
        />
      )}
      {scheduling && (
        <ScheduleDialog
          state={state}
          task={scheduling}
          day={day}
          onClose={() => setScheduling(null)}
          onSave={onSchedule}
        />
      )}
    </>
  );
}
function ScheduleDialog({
  state,
  task,
  day,
  onClose,
  onSave,
  existing,
}: {
  state: AppState;
  task: Task;
  day: string;
  existing?: Session;
  onClose: () => void;
  onSave: (session: Session) => Promise<boolean>;
}) {
  const { saving, saveError, save, closeWhenIdle } = useSave();
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const availableState = existing
    ? { ...state, sessions: state.sessions.filter((s) => s.id !== existing.id) }
    : state;
  const [selectedDay, setSelectedDay] = useState(day);
  const [minutes, setMinutes] = useState(
    existing?.minutes ??
      Math.min(
        state.preferences.session,
        remainingToSchedule(availableState, task),
      ),
  );
  const today = todayISO();
  const [start, setStart] = useState(() => {
    if (existing) return time(existing.start);
    // Suggest the first free slot that fits on that day.
    const free = firstFreeStart(availableState, day, minutes || 5);
    return time(free ?? windowsOn(state.availability, day)[0]?.[0] ?? 480);
  });
  const [error, setError] = useState("");
  return (
    <Modal
      title={
        existing
          ? "Đổi lịch phiên học"
          : `Dành thời gian ngày ${shortDate(selectedDay)}`
      }
      onClose={closeWhenIdle(onClose)}
    >
      <div className="schedule-dialog-task">
        <span className={`badge ${subjectFor(state.subjects, task.subject).color}`}>
          {subjectFor(state.subjects, task.subject).short}
        </span>
        <h3>{task.title}</h3>
        <p>
          {duration(remainingToSchedule(availableState, task))} chưa được xếp
          vào lịch.
        </p>
      </div>
      <form
        aria-busy={saving}
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const [h, m] = start.split(":").map(Number);
          const startMinutes = h * 60 + m;
          const problem = validateTimebox(
            availableState,
            task,
            selectedDay,
            startMinutes,
            minutes,
          );
          if (problem) {
            setError(problem);
            return;
          }
          void save(async () => {
            const saved = await onSave({
            id,
            taskId: task.id,
            date: selectedDay,
            start: startMinutes,
            minutes,
            done: false,
            version: existing?.version ?? 1,
            });
            if (saved) onClose();
            return saved;
          });
        }}
      >
        <label>
          Ngày học
          <input
            disabled={saving}
            type="date"
            required
            min={today}
            max={task.due >= today ? task.due : undefined}
            value={selectedDay}
            onChange={(e) => {
              setSelectedDay(e.target.value);
              setError("");
            }}
          />
        </label>
        <div className="form-grid">
          <label>
            Bắt đầu lúc
            <input
            disabled={saving}
              type="time"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setError("");
              }}
            />
          </label>
          <label>
            Dành bao nhiêu phút?
            <input
            disabled={saving}
              type="number"
              min={5}
              max={remainingToSchedule(availableState, task)}
              step={5}
              required
              value={minutes}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setError("");
              }}
            />
          </label>
        </div>
        <p className="schedule-hint">
          {windowsOn(state.availability, selectedDay).length
            ? `Giờ học ${weekdayName(selectedDay)}: ${windowsOn(state.availability, selectedDay)
                .map(([s, e]) => `${time(s)}–${time(e)}`)
                .join(", ")}`
            : `${weekdayName(selectedDay)} không có giờ học`}
          {busyOn(state.availability, selectedDay).length ? " · có lịch bận" : ""} · nghỉ giữa phiên{" "}
          {state.preferences.rest} phút · hạn {fullDate(task.due)}.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="form-actions">
          <button type="button" className="button" disabled={saving} onClick={closeWhenIdle(onClose)}>
            Để sau
          </button>
          <button type="submit" className="button dark" disabled={saving}>
            {saving ? "Đang lưu…" : existing ? "Lưu thay đổi" : "Thêm vào lịch"}
            <ArrowUpRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
