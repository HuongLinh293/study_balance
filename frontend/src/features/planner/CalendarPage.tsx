import { PlanningBoard } from "./PlanningBoard";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  LockSimple,
  Prohibit,
  Sparkle,
  ArrowUpRight,
  GoogleLogo,
} from "@phosphor-icons/react";
import { Heading, AddButton } from "../../components/Shared";
import {
  subjectFor,
  time,
  duration,
  type AppState,
  type Task,
  type Session,
} from "../../data/state";
import { busyOn, closedRanges, isMissed, viewHours, windowsOn } from "../../data/schedule";
import {
  addDays,
  parseISODate,
  startOfWeek,
  todayISO,
} from "../../data/dates";
/** Pixels per hour in the week grid (matches the CSS row lines). */
const HOUR = 86;
export function CalendarPage({
  state,
  onAdd,
  onTask,
  onSimulate,
  onSuggest,
  onOpenSettings,
  onSchedule,
  onRemove,
  onFocus,
}: {
  state: AppState;
  onAdd: () => void;
  onTask: (t: Task) => void;
  onSimulate: () => void;
  onSuggest: () => void;
  onOpenSettings: () => void;
  onSchedule: (session: Session) => Promise<boolean>;
  onRemove: (id: string) => void;
  onFocus: (session: Session) => void;
}) {
  const [view, setView] = useState<"plan" | "calendar">("plan");
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<"week" | "day">("week");
  const today = todayISO();
  const grid = viewHours(state.availability, state.sessions);
  const y = (minute: number) => ((minute - grid.from * 60) / 60) * HOUR;
  const [selected, setSelected] = useState(today);
  const weekStart = (weeks: number) => addDays(startOfWeek(today), weeks * 7);
  const days = Array.from({ length: 7 }, (_, i) =>
    addDays(weekStart(offset), i),
  );
  const dayLabel = (d: string) => {
    const date = parseISODate(d);
    return {
      date: date.getDate(),
      month: date.getMonth() + 1,
      year: date.getFullYear(),
    };
  };
  const unplanned = state.tasks.filter(
    (t) =>
      !t.done &&
      !state.sessions.some((s) => s.taskId === t.id && !s.done && !isMissed(s, today)),
  );
  // Open the grid at the first study time of the day in focus (e.g. 18:30 for evening
  // windows) instead of 08:00, so the user does not scroll past empty hours.
  const scrollMark = useRef<HTMLElement>(null);
  const focusDay = mode === "day" ? selected : days.includes(today) ? today : days[0];
  const firstMinute = Math.min(
    ...windowsOn(state.availability, focusDay).map(([s]) => s),
    ...state.sessions.filter((s) => s.date === focusDay).map((s) => s.start),
  );
  const markTop = Number.isFinite(firstMinute) ? Math.max(0, y(firstMinute) - 30) : 0;
  useEffect(() => {
    if (view === "calendar" && markTop > HOUR)
      scrollMark.current?.scrollIntoView({ block: "start", behavior: "instant" });
    // Only when the calendar opens or the visible day changes, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, mode, focusDay]);
  const selectedSessions = state.sessions
    .filter((s) => s.date === selected)
    .sort((a, b) => a.start - b.start);
  if (view === "plan")
    return (
      <>
        <Heading
          eyebrow="LẬP KẾ HOẠCH MỖI NGÀY"
          title="Một ngày vừa đủ."
          description="Chọn điều quan trọng. Dành thời gian cho nó. Còn lại, cứ thảnh thơi."
        >
          <div className="segmented planner-view-switch">
            <button className="active" aria-pressed={true}>
              Bảng kế hoạch
            </button>
            <button aria-pressed={false} onClick={() => setView("calendar")}>
              Lịch tuần
            </button>
          </div>
          <button className="button" onClick={onOpenSettings}>Google Calendar</button>
        <button className="button" onClick={onSuggest}>
            Gợi ý lịch
            <Sparkle size={16} />
          </button>
          <button className="button" onClick={onSimulate}>
            Tôi có lịch bận
            <ArrowUpRight size={16} />
          </button>
        </Heading>
        <PlanningBoard
          state={state}
          onAdd={onAdd}
          onTask={onTask}
          onSchedule={onSchedule}
          onRemove={onRemove}
          onFocus={onFocus}
        />
      </>
    );
  return (
    <>
      <Heading
        eyebrow="DÀNH THỜI GIAN CHO ĐIỀU QUAN TRỌNG"
        title="Một tuần có khoảng thở."
        description="Việc học có chỗ của nó. Cuộc sống cũng vậy."
      >
        <button className="button" onClick={() => setView("plan")}>
          Bảng kế hoạch
        </button>
        <button className="button" onClick={onOpenSettings}>Google Calendar</button>
        <button className="button" onClick={onSuggest}>
          Gợi ý lịch
          <Sparkle size={17} />
        </button>
        <button className="button" onClick={onSimulate}>
          Tôi có lịch bận
          <ArrowUpRight size={17} />
        </button>
        <AddButton onClick={onAdd} />
      </Heading>
      <div className="calendar-toolbar">
        <div className="week-picker">
          <button
            className="icon-button"
            aria-label="Tuần trước"
            onClick={() => {
              setOffset((v) => v - 1);
              setSelected(weekStart(offset - 1));
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <strong>
            {dayLabel(days[0]).date}/{dayLabel(days[0]).month} —{" "}
            {dayLabel(days[6]).date}/{dayLabel(days[6]).month},{" "}
            {dayLabel(days[6]).year}
          </strong>
          <button
            className="icon-button"
            aria-label="Tuần sau"
            onClick={() => {
              setOffset((v) => v + 1);
              setSelected(weekStart(offset + 1));
            }}
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="button small"
            onClick={() => {
              setOffset(0);
              setSelected(today);
            }}
          >
            Hôm nay
          </button>
        </div>
        <div className="segmented">
          <button
            className={mode === "day" ? "active" : ""}
            onClick={() => setMode("day")}
          >
            Ngày
          </button>
          <button
            className={mode === "week" ? "active" : ""}
            onClick={() => setMode("week")}
          >
            Tuần
          </button>
        </div>
      </div>
      <div className="calendar-legend">
        {state.subjects.map((s) => (
          <span key={s.id}>
            <i className={`subject-dot ${s.color}`} />
            {s.short}
          </span>
        ))}
        {state.availability.busy.some((b) => b.source === "google") && (
          <span>
            <i className="gcal-dot" />
            Google Calendar
          </span>
        )}
        <span>
          <LockSimple size={13} />
          Lịch bận
        </span>
      </div>
      <div
        className={`mobile-day-picker ${mode === "day" ? "show-desktop" : ""}`}
      >
        {days.map((d, i) => (
          <button
            key={d}
            className={selected === d ? "active" : ""}
            onClick={() => setSelected(d)}
          >
            {["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i]}
            <strong>{dayLabel(d).date}</strong>
          </button>
        ))}
      </div>
      <div className={`week-calendar ${mode === "day" ? "day-mode" : ""}`}>
        <div className="calendar-time-head">GMT+7</div>
        {days
          .filter((d) => mode === "week" || d === selected)
          .map((d) => (
            <div
              className={`week-day-header ${d === today ? "today" : ""}`}
              key={d}
            >
              <span>
                {
                  [
                    "CN",
                    "THỨ HAI",
                    "THỨ BA",
                    "THỨ TƯ",
                    "THỨ NĂM",
                    "THỨ SÁU",
                    "THỨ BẢY",
                  ][parseISODate(d).getDay()]
                }
              </span>
              <strong>{dayLabel(d).date}</strong>
            </div>
          ))}
        <div className="time-column" style={{ height: grid.hours * HOUR + HOUR }}>
          <i
            ref={scrollMark}
            aria-hidden="true"
            style={{ position: "absolute", top: markTop, height: 1, width: 1 }}
          />
          {Array.from({ length: grid.hours + 1 }, (_, i) => (
            <span key={i}>{String(i + grid.from).padStart(2, "0")}:00</span>
          ))}
        </div>
        {days
          .filter((d) => mode === "week" || d === selected)
          .map((d) => {
            const dayBusy = busyOn(state.availability, d);
            const googleEvents = dayBusy.filter((b) => b.source === "google");
            const manualBusy = dayBusy.filter((b) => b.source !== "google");
            return (
              <div
                className={`calendar-day-column ${d === today ? "is-today" : ""}`}
                style={{ height: grid.hours * HOUR + HOUR }}
                key={d}
              >
                {closedRanges(state.availability, d, grid.from * 60, grid.to * 60).map(([s, e]) => (
                  <div
                    className="calendar-busy closed"
                    key={`c${s}`}
                    style={{ top: y(s), height: ((e - s) / 60) * HOUR }}
                    title={`Ngoài giờ học ${time(s)} – ${time(e)}`}
                  >
                    {e - s >= 45 && (
                      <>
                        <Prohibit size={13} />
                        <span>Ngoài giờ học</span>
                      </>
                    )}
                  </div>
                ))}
                {manualBusy.map((b) => (
                  <div
                    className="calendar-busy"
                    key={b.id}
                    style={{
                      top: y(Math.max(b.startMinute, grid.from * 60)),
                      height: ((Math.min(b.endMinute, grid.to * 60) - Math.max(b.startMinute, grid.from * 60)) / 60) * HOUR,
                    }}
                  >
                    <LockSimple size={13} />
                    <strong>{b.label || "Lịch bận"}</strong>
                    <span>
                      {time(b.startMinute)} – {b.endMinute >= 1440 ? "24:00" : time(b.endMinute)}
                    </span>
                  </div>
                ))}
                {googleEvents.map((b) => {
                  const start = Math.max(b.startMinute, grid.from * 60);
                  const end = Math.min(b.endMinute, grid.to * 60);
                  if (end <= start) return null;
                  const top = y(start);
                  const height = Math.max(22, ((end - start) / 60) * HOUR);
                  const eventName = b.label && b.label !== "Bận · Google Calendar" ? b.label : "Sự kiện Google";
                  return (
                    <div
                      className="calendar-google-event"
                      key={b.id}
                      style={{ top, height }}
                      title={`${eventName}\n${time(b.startMinute)} – ${b.endMinute >= 1440 ? "24:00" : time(b.endMinute)}`}
                    >
                      {height >= 28 && (
                        <span className="gcal-label">
                          <GoogleLogo size={8} weight="bold" />
                          Google
                        </span>
                      )}
                      {height >= 18 && <strong>{eventName}</strong>}
                      {height >= 36 && (
                        <span className="gcal-time">
                          {time(b.startMinute)} – {b.endMinute >= 1440 ? "24:00" : time(b.endMinute)}
                        </span>
                      )}
                    </div>
                  );
                })}
                {state.sessions
                    .filter((s) => s.date === d)
                    .map((s) => {
                      const t = state.tasks.find((t) => t.id === s.taskId)!;
                      const sub = subjectFor(state.subjects, t.subject);
                      return (
                        <button
                          style={{
                            top: `${y(s.start)}px`,
                            height: `${(s.minutes / 60) * HOUR}px`,
                          }}
                          className={`calendar-block ${sub.color} ${s.done || t.done ? "finished" : ""} ${!t.done && isMissed(s, today) ? "missed" : ""} ${s.minutes < 30 ? "short-event" : ""}`}
                          key={s.id}
                          aria-label={`${t.title}, ${time(s.start)} · ${s.minutes} phút${t.done ? ", công việc đã xong" : isMissed(s, today) ? ", phiên đã lỡ" : ""}`}
                          onClick={() => onTask(t)}
                        >
                          <span>
                            {time(s.start)} · {s.minutes}p
                          </span>
                          <strong>{t.title}</strong>
                          <small>
                            {s.done
                              ? "Phiên đã học"
                              : t.done
                                ? "Công việc đã xong"
                                : isMissed(s, today)
                                  ? "Bỏ lỡ"
                                  : sub.short}
                          </small>
                        </button>
                      );
                    })}
              </div>
            );
          })}
      </div>
      <div className="mobile-agenda">
        {selectedSessions.length ? (
          selectedSessions.map((s) => {
            const task = state.tasks.find((t) => t.id === s.taskId)!;
            return (
              <button
                key={s.id}
                className={`agenda-item ${subjectFor(state.subjects, task.subject).color}`}
                onClick={() => onTask(task)}
              >
                <span>
                  {time(s.start)} — {time(s.start + s.minutes)}
                </span>
                <strong>{task.title}</strong>
                <span>
                  {s.done ? "Đã học xong" : isMissed(s, today) ? "Bỏ lỡ" : duration(s.minutes)}
                </span>
              </button>
            );
          })
        ) : (
          <p>
            Ngày này chưa có phiên học. Bạn có thể thêm công việc để bắt đầu.
          </p>
        )}
      </div>
      <div className="calendar-bottom">
        <span>
          <Clock size={17} />
          Múi giờ Việt Nam (GMT+7)
        </span>
        <span>
          {unplanned.length
            ? `${unplanned.length} công việc chưa có phiên học`
            : "Các công việc đang mở đều có phiên học"}
        </span>
      </div>
    </>
  );
}
