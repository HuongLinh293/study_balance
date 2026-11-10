import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  IconContext,
  SquaresFour,
  CalendarBlank,
  CheckSquare,
  Books,
  ArrowsLeftRight,
  ChartBar,
  GearSix,
  MagnifyingGlass,
  Bell,
  ArrowUpRight,
  CaretDown,
  List,
  X,
  Sun,
  Sparkle,
  Play,
  Pause,
  Check,
  Timer,
  Clock,
  ArrowRight,
  Circle,
  WarningCircle,
} from "@phosphor-icons/react";
import { Dashboard } from "../features/planner/Dashboard";
import { TasksPage, SubjectsPage } from "../features/tasks/TasksPage";
import { CalendarPage } from "../features/planner/CalendarPage";
import { SimulationPage } from "../features/planner/SimulationPage";
import { AnalyticsPage } from "../features/planner/AnalyticsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TaskForm, TaskDetail } from "../features/tasks/TaskDialogs";
import { SubjectForm } from "../features/tasks/SubjectDialog";
import { PlanProposalDialog } from "../features/planner/PlanProposalDialog";
import { Modal, EmptyState } from "../components/Shared";
import { AuthScreen, LoadingScreen } from "../features/auth/AuthScreen";
import {
  DEFAULT_NAME,
  subjectFor,
  type AppState,
  type Subject,
  type Task,
  type Session,
  type Page,
} from "../data/state";
import { longDate, todayISO } from "../data/dates";
import { ApiError, auth, messageFor, setSignedOutHandler } from "../lib/api";
import {
  ProgressNotSavedError,
  useStudyData,
  type Notification,
} from "../lib/studyData";

const navigation = [
  { id: "today", label: "Hôm nay", icon: SquaresFour },
  { id: "tasks", label: "Công việc", icon: CheckSquare },
  { id: "calendar", label: "Lịch của tôi", icon: CalendarBlank },
  { id: "subjects", label: "Môn học", icon: Books },
  { id: "simulation", label: "Thử thay đổi", icon: ArrowsLeftRight },
  { id: "analytics", label: "Nhìn lại", icon: ChartBar },
] as const;
const validPages: Page[] = [
  "today",
  "tasks",
  "calendar",
  "subjects",
  "simulation",
  "analytics",
  "settings",
];
const readPage = (): Page => {
  const hash = location.hash.slice(1) as Page;
  return validPages.includes(hash) ? hash : "today";
};
export function App() {
  const client = useQueryClient();
  const [status, setStatus] = useState<"checking" | "signedOut" | "signedIn">(
    "checking",
  );
  useEffect(() => {
    setSignedOutHandler(() => {
      client.clear();
      setStatus("signedOut");
    });
    auth.restore().then((ok) => setStatus(ok ? "signedIn" : "signedOut"));
  }, [client]);
  if (status === "checking") return <LoadingScreen />;
  if (status === "signedOut")
    return <AuthScreen onSignedIn={() => setStatus("signedIn")} />;
  return (
    <SignedIn
      onSignOut={async () => {
        await auth.logout();
        client.clear();
        setStatus("signedOut");
      }}
    />
  );
}
function SignedIn({ onSignOut }: { onSignOut: () => void }) {
  const { state, error, notifications, actions } = useStudyData();
  if (state)
    return (
      <Workspace
        state={state}
        notifications={notifications?.items ?? []}
        unreadCount={notifications?.unreadCount ?? 0}
        actions={actions}
        onSignOut={onSignOut}
      />
    );
  return (
    <LoadingScreen text={error ? messageFor(error) : undefined} />
  );
}
type Actions = ReturnType<typeof useStudyData>["actions"];
function Workspace({
  state,
  notifications,
  unreadCount,
  actions,
  onSignOut,
}: {
  state: AppState;
  notifications: Notification[];
  unreadCount: number;
  actions: Actions;
  onSignOut: () => void;
}) {
  const syncing = useIsFetching() > 0;
  const [page, setPage] = useState<Page>(readPage);
  const [sidebar, setSidebar] = useState(false);
  const [form, setForm] = useState<Task | "new" | null>(null);
  const [subjectForm, setSubjectForm] = useState<Subject | "new" | null>(
    null,
  );
  const [detail, setDetail] = useState<string | null>(null);
  const [focus, setFocus] = useState<Session | null>(null);
  const [notification, setNotification] = useState(false);
  const [search, setSearch] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [subjectFilter, setSubjectFilter] = useState("all");
  const notify = (text: string, error = false) => setToast({ text, error });
  /** Runs a server write; shows the outcome as a toast and reports success. */
  const run = async (work: () => Promise<unknown>, success?: string) => {
    try {
      await work();
      if (success) notify(success);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT")
        actions.reload();
      notify(
        error instanceof ProgressNotSavedError
          ? "Đã lưu thời gian học, nhưng chưa cập nhật được thời lượng còn lại. Mở chi tiết công việc để thử lại."
          : messageFor(error),
        true,
      );
      return false;
    }
  };
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const handle = () => setPage(readPage());
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch("");
      }
      if (e.key === "Escape") setSidebar(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const navigate = (p: Page) => {
    setPage(p);
    location.hash = p;
    setSidebar(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const add = () => setForm("new");
  const openTask = (task: Task) => setDetail(task.id);
  const toggle = (id: string, success?: string) => {
    const task = state.tasks.find((t) => t.id === id);
    if (task) void run(() => actions.setTaskDone(task, !task.done), success);
  };
  const selected = state.tasks.find((t) => t.id === detail);
  const openCount = state.tasks.filter((t) => !t.done).length;
  const today = todayISO();
  const initial = state.preferences.name.slice(0, 1).toUpperCase();
  return (
    <IconContext.Provider value={{ size: 20, weight: "regular" }}>
      <div className="app-shell">
        <a
          className="skip-link"
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById("main-content")?.focus();
          }}
        >
          Đi đến nội dung
        </a>
        {sidebar && (
          <button
            className="sidebar-scrim"
            aria-label="Đóng menu"
            onClick={() => setSidebar(false)}
          />
        )}
        <aside className={`sidebar ${sidebar ? "open" : ""}`}>
          <a className="brand" href="#today" onClick={() => navigate("today")}>
            <span className="brand-symbol">
              <span />
              <span />
            </span>
            <span>
              study<span className="brand-light">balance</span>
              <i>®</i>
            </span>
          </a>
          <button
            className="mobile-close icon-button"
            aria-label="Đóng menu"
            onClick={() => setSidebar(false)}
          >
            <X />
          </button>
          <div className="workspace">
            <span className="workspace-avatar">{initial}</span>
            <span>
              Góc học tập của tôi<small>{longDate(today)}</small>
            </span>
            <span className="workspace-dot" />
          </div>
          <span className="nav-caption">MỖI NGÀY MỘT CHÚT</span>
          <nav aria-label="Điều hướng chính">
            {navigation.map(({ id, label, icon: Icon }, i) => (
              <div key={id}>
                {i === 4 && (
                  <span className="nav-caption second">DÀNH CHO BẠN</span>
                )}
                <button
                  className={`nav-link ${page === id ? "active" : ""}`}
                  aria-current={page === id ? "page" : undefined}
                  onClick={() => {
                    if (id === "tasks") setSubjectFilter("all");
                    navigate(id);
                  }}
                >
                  <Icon size={19} weight={page === id ? "fill" : "regular"} />
                  <span>{label}</span>
                  {id === "tasks" && <small>{openCount}</small>}
                  {id === "simulation" && (
                    <span className="nav-sparkle">
                      <Sparkle size={13} />
                    </span>
                  )}
                </button>
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-message">
              <span className="sidebar-flower">
                <Sun size={27} />
              </span>
              <p>
                Học hết mình.
                <br />
                Sống cân bằng.
              </p>
              <span>Mỗi ngày, tốt hơn một chút.</span>
            </div>
            <button
              className={`nav-link ${page === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <GearSix size={19} />
              <span>Cài đặt</span>
            </button>
            <button className="profile" onClick={() => navigate("settings")}>
              <span className="avatar">{initial}</span>
              <span>
                <strong>{state.preferences.name}</strong>
                <small>Sinh viên</small>
              </span>
              <ArrowUpRight size={17} />
            </button>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button menu-button"
                aria-label="Mở menu"
                onClick={() => setSidebar(true)}
              >
                <List />
              </button>
              <span>Không gian cá nhân</span>
              <span className="breadcrumb-slash">/</span>
              <strong>
                {navigation.find((n) => n.id === page)?.label ?? "Cài đặt"}
              </strong>
            </div>
            <div className="topbar-actions">
              <button
                aria-label="Tìm trong góc học tập"
                className="global-search"
                onClick={() => setSearch("")}
              >
                <MagnifyingGlass size={18} />
                <span>Tìm điều gì đó…</span>
                <kbd>⌘ K</kbd>
              </button>
              <span className="topbar-divider" />
              <button
                className="notification-button icon-button"
                aria-label="Thông báo"
                onClick={() => setNotification(true)}
              >
                <Bell size={21} />
                {unreadCount > 0 && state.preferences.reminders && <i />}
              </button>
              <button
                className="avatar top-avatar"
                aria-label="Cài đặt hồ sơ"
                onClick={() => navigate("settings")}
              >
                {initial}
              </button>
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className={`main-content page-${page}`}
            key={page}
          >
            {page === "today" && (
              <Dashboard
                state={state}
                navigate={navigate}
                onAdd={add}
                onTask={openTask}
                onToggle={toggle}
                onFocus={setFocus}
                onNote={(note) =>
                  void run(() => actions.saveProfile({ note }), "Đã lưu lời nhắn.")
                }
              />
            )}
            {page === "tasks" && (
              <TasksPage
                tasks={state.tasks}
                subjects={state.subjects}
                onAdd={add}
                onTask={openTask}
                onToggle={toggle}
                initialSubject={subjectFilter}
              />
            )}
            {page === "subjects" && (
              <SubjectsPage
                tasks={state.tasks}
                subjects={state.subjects}
                onAdd={() => setSubjectForm("new")}
                onEdit={setSubjectForm}
                onSelect={(id) => {
                  setSubjectFilter(id);
                  navigate("tasks");
                }}
              />
            )}
            {page === "calendar" && (
              <CalendarPage
                state={state}
                onAdd={add}
                onTask={openTask}
                onSimulate={() => navigate("simulation")}
                onSuggest={() => setSuggesting(true)}
                onOpenSettings={() => navigate("settings")}
                onSchedule={(session) =>
                  run(
                    () =>
                      actions.saveSession(
                        session,
                        state.sessions.find((p) => p.id === session.id),
                      ),
                    "Đã dành một khoảng thời gian cho công việc.",
                  )
                }
                onRemove={(id) =>
                  void run(
                    () => actions.removeSession(id),
                    "Đã bỏ phiên khỏi lịch. Công việc vẫn còn trong danh sách.",
                  )
                }
                onFocus={setFocus}
              />
            )}
            {page === "simulation" && (
              <SimulationPage
                state={state}
                onApplied={(message) => {
                  actions.reload();
                  notify(message);
                }}
                onSaveBusy={(busy) => run(() => actions.addBusy(busy))}
                onEditTask={setForm}
                onOpenSettings={() => navigate("settings")}
              />
            )}
            {page === "analytics" && <AnalyticsPage state={state} />}
            {page === "settings" && (
              <SettingsPage
                email={state.email}
                preferences={state.preferences}
                onSave={(preferences) =>
                  run(
                    () =>
                      actions.saveProfile({
                        name: preferences.name.trim() || DEFAULT_NAME,
                        preferences,
                      }),
                    "Đã lưu nhịp học của bạn.",
                  )
                }
                availability={state.availability}
                onSaveWindows={(windows, version) =>
                  run(() => actions.saveWindows(windows, version), "Đã lưu lịch rảnh trong tuần.")
                }
                onAddBusy={(busy) => run(() => actions.addBusy(busy), "Đã thêm lịch bận.")}
                onRemoveBusy={(id) => void run(() => actions.removeBusy(id), "Đã xóa lịch bận.")}
                onChangePassword={(current, next) =>
                  run(
                    () => actions.changePassword(current, next),
                    "Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.",
                  )
                }
                onSignOut={onSignOut}
              />
            )}
          </main>
          <div className="demo-label" role="status">
            <Circle size={7} weight="fill" />
            {syncing ? "Đang đồng bộ…" : "Đã đồng bộ với máy chủ"}
          </div>
        </div>
        {form && (
          <TaskForm
            subjects={state.subjects}
            task={form === "new" ? undefined : form}
            onClose={() => setForm(null)}
            onSave={async (task) => {
              const existing = state.tasks.find((t) => t.id === task.id);
              const saved = await run(
                () => actions.saveTask(task, existing),
                existing
                  ? "Đã lưu thay đổi."
                  : "Đã thêm công việc. Bạn có thể xem trong Công việc.",
              );
              if (saved) setForm(null);
              return saved;
            }}
          />
        )}
        {selected && (
          <TaskDetail
            task={selected}
            subjects={state.subjects}
            sessionCount={
              state.sessions.filter((s) => s.taskId === selected.id && !s.done).length
            }
            doneSessions={state.sessions
              .filter((s) => s.taskId === selected.id && s.done)
              .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)}
            onApplyProgress={(session) =>
              void run(() => actions.applyProgress(session), "Đã cập nhật thời lượng còn lại.")
            }
            onClose={() => setDetail(null)}
            onDelete={async () => {
              if (await run(() => actions.deleteTask(selected.id), "Đã xóa công việc."))
                setDetail(null);
            }}
            onEdit={() => {
              setForm(selected);
              setDetail(null);
            }}
            onToggle={() =>
              toggle(
                selected.id,
                selected.done
                  ? "Đã mở lại công việc."
                  : "Thêm một việc hoàn thành. Bạn làm tốt lắm!",
              )
            }
          />
        )}
        {focus && (
          <FocusModal
            session={focus}
            preferredMinutes={state.preferences.session}
            title={
              state.tasks.find((t) => t.id === focus.taskId)?.title ??
              "Phiên tập trung"
            }
            onClose={() => setFocus(null)}
            onFinish={async (minutes) => {
              const session = focus;
              setFocus(null);
              await run(
                () => actions.finishSession(session, minutes),
                `Đã ghi nhận ${minutes} phút. Đã cập nhật thời lượng còn lại của công việc.`,
              );
            }}
          />
        )}
        {suggesting && (
          <PlanProposalDialog
            state={state}
            onClose={() => setSuggesting(false)}
            onApplied={(message) => {
              setSuggesting(false);
              actions.reload();
              notify(message);
            }}
            onEditTask={(task) => {
              setSuggesting(false);
              setForm(task);
            }}
            onOpenSettings={() => {
              setSuggesting(false);
              navigate("settings");
            }}
          />
        )}
        {subjectForm && (
          <SubjectForm
            subject={subjectForm === "new" ? undefined : subjectForm}
            taskCount={
              subjectForm === "new"
                ? 0
                : state.tasks.filter((t) => t.subject === subjectForm.id).length
            }
            onClose={() => setSubjectForm(null)}
            onSave={async (subject) => {
              const isNew = subjectForm === "new";
              const saved = await run(
                () => actions.saveSubject(subject, isNew),
                isNew ? "Đã thêm môn học." : "Đã lưu môn học.",
              );
              if (saved) setSubjectForm(null);
              return saved;
            }}
            onDelete={async () => {
              if (subjectForm === "new") return;
              if (await run(() => actions.deleteSubject(subjectForm.id), "Đã xóa môn học."))
                setSubjectForm(null);
            }}
          />
        )}
        {notification && (
          <Modal
            title="Một vài điều cần nhớ"
            onClose={() => setNotification(false)}
          >
            {state.preferences.reminders ? (
              <>
                <p className="modal-intro">
                  Lời nhắc cho {longDate(today).toLocaleLowerCase("vi")}.
                </p>
                {notifications.length ? (
                  <div
                    className={`notification-list ${unreadCount ? "" : "read"}`}
                  >
                    {notifications.map((n) => (
                      <div key={n.id} className={n.read ? "is-read" : ""}>
                        <span
                          className={`round-icon ${n.kind === "deadline" ? "yellow" : "pink"}`}
                        >
                          {n.kind === "deadline" ? <Clock /> : <Sparkle />}
                        </span>
                        <div>
                          <h3>{n.title}</h3>
                          <p>{n.body}</p>
                          <small>
                            {n.kind === "deadline" ? "Nhắc deadline" : "Kế hoạch"}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Không có gì cần nhắc."
                    text="Deadline trong hôm nay, ngày mai và phiên học hôm nay sẽ hiện ở đây."
                  />
                )}
                {notifications.length > 0 && (
                  <button
                    className="button full"
                    disabled={!unreadCount}
                    onClick={() => void run(() => actions.readAllNotifications())}
                  >
                    <Check size={17} />
                    {unreadCount ? "Đánh dấu tất cả đã đọc" : "Đã đọc tất cả"}
                  </button>
                )}
              </>
            ) : (
              <EmptyState
                title="Lời nhắc đang tắt."
                text="Bạn có thể bật lại trong phần Cài đặt."
              />
            )}
          </Modal>
        )}
        {search !== null && (
          <Modal title="Tìm trong góc học tập" onClose={() => setSearch(null)}>
            <label className="search-box modal-search">
              <MagnifyingGlass />
              <input
                autoFocus
                aria-label="Tìm trong góc học tập"
                placeholder="Tên công việc hoặc môn học…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="search-results">
              {state.tasks
                .filter((t) =>
                  `${t.title} ${subjectFor(state.subjects, t.subject).name}`
                    .toLocaleLowerCase("vi")
                    .includes(search.toLocaleLowerCase("vi")),
                )
                .map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSearch(null);
                      openTask(t);
                    }}
                  >
                    <i
                      className={`subject-dot ${subjectFor(state.subjects, t.subject).color}`}
                    />
                    <span>
                      <strong>{t.title}</strong>
                      <small>{subjectFor(state.subjects, t.subject).short}</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                ))}
              {!state.tasks.some((t) =>
                `${t.title} ${subjectFor(state.subjects, t.subject).name}`
                  .toLocaleLowerCase("vi")
                  .includes(search.toLocaleLowerCase("vi")),
              ) && (
                <EmptyState
                  title="Chưa tìm thấy kết quả."
                  text="Thử một từ khóa ngắn hơn nhé."
                />
              )}
            </div>
          </Modal>
        )}
        {toast && (
          <div
            className={`toast ${toast.error ? "is-error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? <WarningCircle size={18} /> : <Check size={18} />}
            <span>{toast.text}</span>
            <button
              className="icon-button"
              aria-label="Đóng thông báo"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
}
function FocusModal({
  session,
  preferredMinutes,
  title,
  onClose,
  onFinish,
}: {
  session: Session;
  preferredMinutes: number;
  title: string;
  onClose: () => void;
  onFinish: (minutes: number) => void;
}) {
  const targetMinutes = Math.min(session.minutes, preferredMinutes);
  const [seconds, setSeconds] = useState(targetMinutes * 60);
  const [running, setRunning] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [actual, setActual] = useState(1);
  useEffect(() => {
    if (!running) return;
    let previous = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - previous) / 1000);
      if (elapsed) {
        previous += elapsed * 1000;
        setSeconds((s) => Math.max(0, s - elapsed));
      }
    }, 250);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (seconds === 0) setRunning(false);
  }, [seconds]);
  return (
    <Modal title="Chỉ một việc, ngay lúc này." onClose={onClose}>
      <div className="focus-modal-body">
        <span className="round-icon pink">
          <Timer size={25} />
        </span>
        <h3>{title}</h3>
        <div
          className="timer-display"
          role="timer"
          aria-label={`${Math.floor(seconds / 60)} phút ${seconds % 60} giây`}
        >
          {String(Math.floor(seconds / 60)).padStart(2, "0")}
          <span>:</span>
          {String(seconds % 60).padStart(2, "0")}
        </div>
        <p>
          {seconds === 0
            ? "Đã hết thời gian. Nghỉ một chút nhé!"
            : running
              ? "Cứ tập trung vào bước tiếp theo."
              : "Hít thở một chút. Bắt đầu khi bạn sẵn sàng."}
        </p>
        {!finishing ? (
          <>
            <button
              className="button dark"
              disabled={seconds === 0}
              onClick={() => setRunning(!running)}
            >
              {running ? (
                <Pause weight="fill" size={17} />
              ) : (
                <Play weight="fill" size={17} />
              )}
              {running ? "Tạm dừng" : "Bắt đầu"}
            </button>
            <button
              className="text-button finish-session"
              onClick={() => {
                setRunning(false);
                setActual(
                  Math.max(1, Math.ceil((targetMinutes * 60 - seconds) / 60)),
                );
                setFinishing(true);
              }}
            >
              Kết thúc & ghi nhận
              <Check size={17} />
            </button>
            <small>Đóng cửa sổ sẽ dừng phiên chưa được ghi nhận.</small>
          </>
        ) : (
          <form
            className="finish-form"
            onSubmit={(e) => {
              e.preventDefault();
              onFinish(actual);
            }}
          >
            <label>
              Thời gian thực tế đã học (phút)
              <input
                required
                type="number"
                min={1}
                max={600}
                value={actual}
                onChange={(e) => setActual(Number(e.target.value))}
              />
            </label>
            <p>Kết thúc phiên không tự đánh dấu công việc hoàn thành.</p>
            <button className="button dark" type="submit">
              Lưu phiên học
              <Check size={17} />
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
