import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Sun,
  Sparkle,
  Play,
  Clock,
  Check,
  Coffee,
  Leaf,
  ArrowBendUpRight,
  PencilSimple,
  Flower,
  StarFour,
} from "@phosphor-icons/react";
import {
  AddButton,
  Heading,
  SectionTitle,
  TaskRow,
  EmptyState,
} from "../../components/Shared";
import {
  subjectFor,
  time,
  duration,
  type AppState,
  type Page,
  type Task,
  type Session,
} from "../../data/state";
import {
  addDays,
  longDate,
  parseISODate,
  shortDate,
  toISODate,
  todayISO,
} from "../../data/dates";

interface Props {
  state: AppState;
  navigate: (page: Page) => void;
  onAdd: () => void;
  onTask: (task: Task) => void;
  onToggle: (id: string) => void;
  onFocus: (session: Session) => void;
  onNote: (text: string) => void;
}
export function Dashboard({
  state,
  navigate,
  onAdd,
  onTask,
  onToggle,
  onFocus,
  onNote,
}: Props) {
  const [tab, setTab] = useState("important");
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState(state.note);
  const today = todayISO();
  const [calendarOffset, setCalendarOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(today);
  const base = parseISODate(today);
  const date = new Date(base.getFullYear(), base.getMonth() + calendarOffset, 1);
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const pad = (date.getDay() + 6) % 7;
  const dateOf = (day: number) =>
    toISODate(new Date(date.getFullYear(), date.getMonth(), day));
  const sessionDates = new Set(state.sessions.map((s) => s.date));
  const todaySessions = state.sessions
    .filter((s) => s.date === today)
    .sort((a, b) => a.start - b.start);
  const next = todaySessions.find(
    (s) => !s.done && !state.tasks.find((t) => t.id === s.taskId)?.done,
  );
  const nextTask = state.tasks.find((t) => t.id === next?.taskId);
  const doneMinutes = todaySessions
    .filter((s) => s.done)
    .reduce((a, s) => a + (s.actualMinutes ?? s.minutes), 0);
  const totalMinutes = todaySessions.reduce((a, s) => a + s.minutes, 0);
  const completed = state.tasks.filter((t) => t.done).length;
  const tasks = state.tasks.filter((t) =>
    tab === "done"
      ? t.done
      : !t.done && (tab !== "important" || t.priority === "high"),
  );
  const daySessions = state.sessions
    .filter((s) => s.date === selectedDate)
    .sort((a, b) => a.start - b.start);
  return (
    <>
      <Heading
        eyebrow="KHÔNG GIAN HỌC TẬP CỦA BẠN"
        title={`Một ngày tốt lành, ${state.preferences.name}.`}
        description="Không cần làm tất cả. Chỉ cần dành thời gian cho điều quan trọng."
      >
        <button className="button" onClick={() => navigate("calendar")}>
          Lập kế hoạch
          <ArrowUpRight size={16} />
        </button>
        <AddButton onClick={onAdd} />
      </Heading>
      <div className="dashboard-layout">
        <div className="dashboard-main">
          <div className="daily-line">
            <span>
              <Sun size={18} />
              {longDate(today)}
            </span>
            <span className="small-label">MỘT CHÚT TẬP TRUNG, MỖI NGÀY</span>
          </div>
          <div className="overview-grid">
            <section className="focus-card pink">
              <div className="card-kicker">
                <span>
                  <span className="live-dot" /> TIẾP THEO, TẬP TRUNG VÀO
                </span>
                <ArrowUpRight size={21} />
              </div>
              <div className="focus-art" aria-hidden="true">
                <Flower size={112} weight="fill" />
                <span className="art-center">
                  <StarFour size={30} weight="fill" />
                </span>
              </div>
              <div className="focus-copy">
                <span className="focus-subject">
                  {nextTask
                    ? subjectFor(state.subjects, nextTask.subject).short
                    : state.tasks.length
                      ? "Bạn đã làm rất tốt"
                      : "Bắt đầu từ đây"}
                </span>
                <h2>
                  {nextTask?.title ??
                    (state.tasks.length
                      ? "Một khoảng nghỉ xứng đáng."
                      : "Ghi lại việc đầu tiên.")}
                </h2>
                <p>
                  {nextTask
                    ? "Một bước gần hơn đến mục tiêu của riêng bạn."
                    : state.tasks.length
                      ? "Không còn phiên học cần tập trung hôm nay."
                      : "Thêm công việc, rồi xếp một phiên học vào lịch."}
                </p>
              </div>
              <div className="focus-bottom">
                <button
                  className="button dark"
                  onClick={() =>
                    next
                      ? onFocus(next)
                      : state.tasks.length
                        ? navigate("calendar")
                        : onAdd()
                  }
                >
                  <Play weight="fill" size={15} />
                  {next
                    ? "Bắt đầu tập trung"
                    : state.tasks.length
                      ? "Xem kế hoạch"
                      : "Thêm công việc"}
                </button>
                <span>
                  <Clock size={15} />
                  {next ? `${next.minutes} phút` : "Thảnh thơi nhé"}
                </span>
              </div>
            </section>
            <div className="mini-stats">
              <section className="stat-card yellow">
                <div>
                  <span>Thời gian học hôm nay</span>
                  <Clock size={19} />
                </div>
                <p className="stat-number">
                  {duration(doneMinutes)}
                  <small>/ {duration(totalMinutes)}</small>
                </p>
                <div className="mini-progress">
                  <span
                    style={{
                      width: `${Math.min(100, Math.round((doneMinutes / Math.max(1, totalMinutes)) * 100))}%`,
                    }}
                  />
                </div>
                <span className="stat-foot">
                  {totalMinutes
                    ? "Cứ chậm rãi, bạn đang tiến bộ."
                    : "Chưa có phiên học nào hôm nay."}
                </span>
              </section>
              <section className="stat-card green">
                <div>
                  <span>Công việc hoàn thành</span>
                  <Check size={19} />
                </div>
                <p className="stat-number">
                  {String(completed).padStart(2, "0")}
                  <small>
                    / {String(state.tasks.length).padStart(2, "0")} công việc
                  </small>
                </p>
                <span className="stat-foot">
                  <span className="tiny-check">
                    <Check size={10} />
                  </span>
                  Thêm một việc xong, bớt một điều lo.
                </span>
                <Leaf className="stat-decoration" weight="fill" size={58} />
              </section>
            </div>
          </div>
          <section className="task-section">
            <SectionTitle
              title="Một việc tại một thời điểm."
              label="Tất cả công việc"
              onClick={() => navigate("tasks")}
            />
            <div
              className="folder-tabs"
              role="group"
              aria-label="Nhóm công việc"
            >
              {[
                ["important", "Cần ưu tiên"],
                ["all", "Đang thực hiện"],
                ["done", "Đã hoàn thành"],
              ].map(([id, label]) => (
                <button
                  aria-pressed={tab === id}
                  key={id}
                  onClick={() => setTab(id)}
                  className={tab === id ? "active" : ""}
                >
                  {label}
                  <span>
                    {
                      state.tasks.filter((t) =>
                        id === "done"
                          ? t.done
                          : !t.done &&
                            (id !== "important" || t.priority === "high"),
                      ).length
                    }
                  </span>
                </button>
              ))}
            </div>
            <div className="folder-body">
              <div className="list-caption">
                <span>CÔNG VIỆC & MÔN HỌC</span>
                <span>DEADLINE</span>
              </div>
              {tasks.length ? (
                tasks
                  .slice(0, 4)
                  .map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      subjects={state.subjects}
                      onOpen={() => onTask(t)}
                      onToggle={() => onToggle(t.id)}
                    />
                  ))
              ) : (
                <EmptyState
                  title={
                    state.tasks.length
                      ? "Mọi việc đã ổn."
                      : "Danh sách đang trống."
                  }
                  text={
                    state.tasks.length
                      ? "Bạn không có công việc nào trong nhóm này."
                      : "Thêm bài tập, deadline hoặc việc cần ôn để bắt đầu."
                  }
                />
              )}
              <button className="add-inline" onClick={onAdd}>
                <span>+</span>Thêm một việc cần làm
              </button>
            </div>
          </section>
          <div className="bottom-grid">
            <section className="balance-card">
              <div className="section-title">
                <h3>Chừa chỗ cho cuộc sống.</h3>
                <span className="round-icon blue">
                  <Coffee size={20} />
                </span>
              </div>
              <p>
                Kế hoạch tốt cũng có những khoảng nghỉ.
                <br />
                Lịch thay đổi? Mình cùng sắp xếp lại.
              </p>
              <button
                className="text-button"
                onClick={() => navigate("simulation")}
              >
                Hôm nay tôi bận
                <ArrowBendUpRight size={19} />
              </button>
              <div className="balance-decoration" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </section>
            <section className="sticky-note">
              <div className="tape" />
              <div className="note-heading">
                <span>GỬI MÌNH MỘT LỜI NHẮN</span>
                <button
                  className="icon-button"
                  aria-label={editingNote ? "Lưu lời nhắn" : "Sửa lời nhắn"}
                  onClick={() => {
                    if (editingNote && noteDraft !== state.note) onNote(noteDraft);
                    if (!editingNote) setNoteDraft(state.note);
                    setEditingNote(!editingNote);
                  }}
                >
                  {editingNote ? (
                    <Check size={17} />
                  ) : (
                    <PencilSimple size={17} />
                  )}
                </button>
              </div>
              {editingNote ? (
                <textarea
                  aria-label="Lời nhắn cho bản thân"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={160}
                  autoFocus
                />
              ) : (
                <p>
                  {state.note ||
                    "Viết một lời nhắn nhỏ cho chính mình. Bấm bút chì để bắt đầu."}
                </p>
              )}
              <span className="note-signature">— mình, của hôm nay</span>
              <Sparkle className="note-sparkle" size={26} />
            </section>
          </div>
          <div className="page-foot">
            <span className="small-logo">sb.</span>Kế hoạch thay đổi cùng bạn.
            <span>HỌC TẬP • NGHỈ NGƠI • CÂN BẰNG</span>
          </div>
        </div>
        <aside className="day-panel">
          <div className="mini-calendar">
            <div className="calendar-month">
              <button
                className="icon-button"
                aria-label="Tháng trước"
                onClick={() => {
                  setCalendarOffset((v) => v - 1);
                  setSelectedDate(
                    toISODate(
                      new Date(date.getFullYear(), date.getMonth() - 1, 1),
                    ),
                  );
                }}
              >
                <ArrowLeft size={17} />
              </button>
              <strong>
                Tháng {date.getMonth() + 1}, {date.getFullYear()}
              </strong>
              <button
                className="icon-button"
                aria-label="Tháng sau"
                onClick={() => {
                  setCalendarOffset((v) => v + 1);
                  setSelectedDate(
                    toISODate(
                      new Date(date.getFullYear(), date.getMonth() + 1, 1),
                    ),
                  );
                }}
              >
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="calendar-grid">
              {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (
                <span className="weekday" key={d}>
                  {d}
                </span>
              ))}
              {Array.from({ length: pad }, (_, i) => (
                <span key={`p${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => (
                <button
                  aria-label={`Ngày ${i + 1} tháng ${date.getMonth() + 1}`}
                  aria-pressed={selectedDate === dateOf(i + 1)}
                  className={`${selectedDate === dateOf(i + 1) ? "selected" : ""} ${sessionDates.has(dateOf(i + 1)) ? "has-session" : ""}`}
                  key={i}
                  onClick={() => setSelectedDate(dateOf(i + 1))}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              className="calendar-today"
              onClick={() => {
                setCalendarOffset(0);
                setSelectedDate(today);
              }}
            >
              Về hôm nay
              <ArrowBendUpRight size={13} />
            </button>
          </div>
          <div className="timeline-title">
            <h2>
              {selectedDate === today
                ? "Nhịp học hôm nay"
                : selectedDate === addDays(today, 1)
                  ? "Ngày mai"
                  : `Ngày ${shortDate(selectedDate)}`}
            </h2>
            <span>{daySessions.length} phiên</span>
          </div>
          <div className="timeline">
            {daySessions.map((s, i) => {
              const task = state.tasks.find((t) => t.id === s.taskId)!;
              const subject = subjectFor(state.subjects, task.subject);
              return (
                <div
                  className={`timeline-row ${s.done || task.done ? "completed" : ""}`}
                  key={s.id}
                >
                  <span className="timeline-time">{time(s.start)}</span>
                  <button
                    onClick={() => onTask(task)}
                    className={`timeline-event ${subject.color} ${s.id === next?.id ? "next" : ""}`}
                  >
                    <span className="event-top">
                      <span className={`round-icon ${subject.color}`}>
                        {s.done ? <Check size={15} /> : <BookIcon index={i} />}
                      </span>
                      {s.done || task.done ? (
                        <span className="event-state">
                          {s.done ? "Phiên đã học" : "Công việc đã xong"}
                        </span>
                      ) : s.id === next?.id ? (
                        <span className="event-state">Tiếp theo</span>
                      ) : null}
                    </span>
                    <strong>{task.title}</strong>
                    <span className="event-subject">{subject.short}</span>
                    <span className="event-duration">
                      {time(s.start)} – {time(s.start + s.minutes)}
                    </span>
                  </button>
                </div>
              );
            })}
            {!daySessions.length && (
              <div className="timeline-empty">
                <Sun size={26} />
                <p>Một ngày còn nhiều khoảng trống.</p>
                <button
                  className="text-button"
                  onClick={() => navigate("calendar")}
                >
                  Xem lịch tuần
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="rest-line">
            <Coffee size={17} />
            <span>Đừng quên nghỉ giữa các phiên nhé.</span>
          </div>
          <button
            className="button full dark"
            onClick={() => navigate("calendar")}
          >
            Mở lịch của tôi
            <ArrowUpRight size={17} />
          </button>
        </aside>
      </div>
    </>
  );
}
function BookIcon({ index }: { index: number }) {
  return index % 2 ? <PencilSimple size={15} /> : <Clock size={15} />;
}
