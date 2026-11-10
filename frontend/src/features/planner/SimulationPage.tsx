import { applyAndSaveBusy } from "../../lib/saveFlow";
import { useRef, useState } from "react";
import {
  ArrowRight,
  ArrowsLeftRight,
  Check,
  Clock,
  Sparkle,
  WarningCircle,
  ArrowBendDownRight,
} from "@phosphor-icons/react";
import { Heading, EmptyState } from "../../components/Shared";
import { time, duration, subjectFor, noSubject, type AppState, type Task } from "../../data/state";
import { addDays, shortDate, todayISO, weekdayName } from "../../data/dates";
import { messageFor } from "../../lib/api";
import { simulationsApi, type Simulation } from "../../lib/studyData";
type Scenario = "afternoon" | "whole" | "custom";
export function SimulationPage({
  state,
  onApplied,
  onSaveBusy,
  onEditTask,
  onOpenSettings,
}: {
  state: AppState;
  onApplied: (message: string) => void;
  onSaveBusy: (busy: { date: string; startMinute: number; endMinute: number; label: string }) => Promise<boolean>;
  onEditTask: (task: Task) => void;
  onOpenSettings: () => void;
}) {
  const today = todayISO();
  const [scenario, setScenario] = useState<Scenario>("afternoon");
  const [custom, setCustom] = useState({ date: today, from: "14:00", to: "17:00", label: "" });
  const [saveBusy, setSaveBusy] = useState(true);
  const [result, setResult] = useState<Simulation | null>(null);
  const applying = useRef(false);
  const [pendingBusy, setPendingBusy] = useState<Simulation["busy"] | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = result !== null;
  const { changed = [], moved = [], unscheduled = [] } = result ?? {};
  const taskOf = (taskId: string) => state.tasks.find((t) => t.id === taskId);
  const reset = () => {
    setResult(null);
    setApplied(false);
    setError("");
  };
  const toMinute = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const load = async () => {
    setBusy(true);
    setError("");
    setApplied(false);
    try {
      if (scenario === "custom") {
        const startMinute = toMinute(custom.from);
        const endMinute = custom.to === "00:00" ? 1440 : toMinute(custom.to);
        if (!(startMinute < endMinute)) throw new Error("range");
        setResult(
          await simulationsApi.preview({ date: custom.date, startMinute, endMinute, label: custom.label.trim() }),
        );
      } else setResult(await simulationsApi.preview({ scenario }));
    } catch (err) {
      setError(
        err instanceof Error && err.message === "range"
          ? "Giờ kết thúc phải sau giờ bắt đầu."
          : messageFor(err),
      );
    } finally {
      setBusy(false);
    }
  };
  const apply = async (dropUnscheduled: boolean) => {
    if (!result || applying.current || pendingBusy) return;
    applying.current = true;
    setBusy(true);
    setError("");
    try {
      // Save busy only after applying: saving it first would invalidate the preview.
      const busySaved = await applyAndSaveBusy(
        () => simulationsApi.apply(result.id, dropUnscheduled),
        saveBusy ? () => onSaveBusy(result.busy) : undefined,
      );
      if (!busySaved) setPendingBusy(result.busy);
      setApplied(true);
      setResult(null);
      onApplied(
        !busySaved
          ? "Đã điều chỉnh phiên học, nhưng chưa lưu được khoảng bận. Hãy thử lưu lại khoảng bận."
          : dropUnscheduled && unscheduled.length
          ? `Đã áp dụng. ${unscheduled.length} phiên được đưa về mục Chưa xếp lịch.`
          : "Đã áp dụng phương án mới vào lịch của bạn.",
      );
    } catch (err) {
      setError(messageFor(err));
      // A stale preview cannot be applied any more; start again from the current plan.
      setResult(null);
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };
  const retryBusy = async () => {
    if (!pendingBusy || applying.current) return;
    applying.current = true;
    setBusy(true);
    try {
      if (await onSaveBusy(pendingBusy)) {
        setPendingBusy(null);
        setError("");
        onApplied("Đã lưu khoảng bận. Các phiên học đã điều chỉnh được giữ nguyên.");
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };
  const when = (date: string) =>
    date === today ? "Hôm nay" : date === addDays(today, 1) ? "Ngày mai" : `${weekdayName(date)} ${shortDate(date)}`;
  return (
    <>
      <Heading
        eyebrow="KẾ HOẠCH THAY ĐỔI CÙNG BẠN"
        title="Nếu hôm nay khác đi?"
        description="Thử một thay đổi nhỏ. Xem tác động. Rồi mới quyết định."
      />
      <div className="simulation-layout">
        <section className="scenario-panel">
          <div className="round-icon pink">
            <ArrowsLeftRight size={23} />
          </div>
          <h2>Cuộc sống có kế hoạch riêng.</h2>
          <p>Bạn muốn dành lại khoảng thời gian nào?</p>
          <div className="scenario-options">
            {(
              [
                ["afternoon", "Tôi bận chiều nay", "Từ 12:00 đến hết ngày"],
                ["whole", "Tôi cần nghỉ cả ngày", "Chuyển các phiên chưa hoàn thành hôm nay"],
                ["custom", "Một khoảng bận khác", "Chọn ngày và khung giờ"],
              ] as const
            ).map(([id, title, description]) => (
              <label className={scenario === id ? "selected" : ""} key={id}>
                <input
                  type="radio"
                  name="scenario"
                  value={id}
                  checked={scenario === id}
                  onChange={() => {
                    setScenario(id);
                    reset();
                  }}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </div>
          {scenario === "custom" && (
            <div className="form scenario-custom">
              <label>
                Ngày
                <input
                  type="date"
                  min={today}
                  max={addDays(today, 30)}
                  value={custom.date}
                  onChange={(e) => {
                    setCustom({ ...custom, date: e.target.value });
                    reset();
                  }}
                />
              </label>
              <div className="form-grid">
                <label>
                  Từ
                  <input type="time" value={custom.from} onChange={(e) => (setCustom({ ...custom, from: e.target.value }), reset())} />
                </label>
                <label>
                  Đến
                  <input type="time" value={custom.to} onChange={(e) => (setCustom({ ...custom, to: e.target.value }), reset())} />
                </label>
              </div>
              <label>
                Ghi chú (không bắt buộc)
                <input
                  maxLength={80}
                  placeholder="Ví dụ: Lịch khám, việc gia đình…"
                  value={custom.label}
                  onChange={(e) => setCustom({ ...custom, label: e.target.value })}
                />
              </label>
            </div>
          )}
          <label className="toggle-label scenario-save">
            <span>
              <strong>Lưu vào lịch bận</strong>
              <small>Sau khi áp dụng, các phiên mới sẽ tránh khoảng này.</small>
            </span>
            <input type="checkbox" role="switch" checked={saveBusy} onChange={(e) => setSaveBusy(e.target.checked)} />
          </label>
          <button className="button dark full" disabled={busy || !!pendingBusy} onClick={load}>
            {busy && !preview ? "Đang tính…" : "Xem phương án mới"}
            <Sparkle size={18} />
          </button>
          <span className="local-caption">Lịch hiện tại giữ nguyên cho đến khi bạn áp dụng</span>
        </section>
        <section className="simulation-result paper-grid">
          {pendingBusy && (
            <div className="form-error" role="alert">
              <p>Phiên học đã được điều chỉnh, nhưng khoảng bận ngày {shortDate(pendingBusy.date)} từ {time(pendingBusy.startMinute)} đến {time(pendingBusy.endMinute)} chưa được lưu. Gợi ý lịch mới vẫn có thể sử dụng khoảng giờ này.</p>
              <button className="button" disabled={busy} onClick={retryBusy}>
                {busy ? "Đang lưu…" : "Thử lưu lại khoảng bận"}
              </button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {applied ? (
            <div className="simulation-placeholder">
              <span className="round-icon green">
                <Check size={30} />
              </span>
              <h2>Kế hoạch đã được điều chỉnh.</h2>
              <p>Bạn có thể xem các phiên mới trong Lịch của tôi. Những phiên đã hoàn thành vẫn được giữ nguyên.</p>
              <span className={`badge ${pendingBusy ? "yellow" : "green"}`}>{pendingBusy ? "Đã lưu phiên học · Chưa lưu khoảng bận" : "Đã lưu vào lịch của bạn"}</span>
            </div>
          ) : !preview ? (
            <div className="simulation-placeholder">
              <div className="preview-illustration" aria-hidden="true">
                <div className="paper-one blue">
                  <span />
                  <span />
                  <span />
                </div>
                <ArrowsLeftRight size={30} />
                <div className="paper-two pink">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
              <h2>Mọi thay đổi đều có thể xem trước.</h2>
              <p>
                Chọn một tình huống bên trái.
                <br />
                Lịch hiện tại giữ nguyên cho đến khi bạn áp dụng.
              </p>
            </div>
          ) : changed.length === 0 ? (
            <>
              <EmptyState
                title="Không có phiên nào cần chuyển."
                text="Khoảng thời gian này đã trống hoặc các phiên đã hoàn thành."
              />
              {saveBusy && (
                <div className="form-actions">
                  <button className="button dark" disabled={busy} onClick={() => apply(false)}>
                    Lưu khoảng bận
                    <Check size={17} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="preview-heading">
                <span className="badge yellow">
                  <Sparkle size={14} />
                  Bản xem trước
                </span>
                <h2>Dành lại {duration(changed.reduce((a, s) => a + s.minutes, 0))} cho bạn.</h2>
                <p>
                  {moved.length} phiên có chỗ mới trước deadline
                  {unscheduled.length ? ` · ${unscheduled.length} phiên chưa xếp được` : " · Không thay đổi deadline"}.
                </p>
              </div>
              <div className="preview-columns">
                <span>KẾ HOẠCH HIỆN TẠI</span>
                <span>PHƯƠNG ÁN MỚI</span>
              </div>
              {changed.map((s) => {
                const task = taskOf(s.taskId);
                const subject = task ? subjectFor(state.subjects, task.subject) : noSubject;
                const next = moved.find((m) => m.id === s.id);
                const stuck = unscheduled.find((u) => u.id === s.id);
                return (
                  <div className="change-row" key={s.id}>
                    <div>
                      <span className={`badge ${subject.color}`}>{subject.short}</span>
                      <h3>{task?.title ?? "Công việc"}</h3>
                      <span>
                        {when(s.date)} · {time(s.startMinute)} – {time(s.startMinute + s.minutes)}
                      </span>
                    </div>
                    <ArrowRight size={20} />
                    <div>
                      <span className="change-label">
                        <ArrowBendDownRight size={17} />
                        {next ? "Chuyển sang" : "Chưa xếp được"}
                      </span>
                      <strong>
                        {next
                          ? `${when(next.date)} · ${time(next.startMinute)} – ${time(next.startMinute + next.minutes)}`
                          : stuck?.reason === "deadline"
                            ? `Không còn khung rảnh trước hạn ${task ? shortDate(task.due) : ""}`
                            : "Không đủ thời gian rảnh trước deadline"}
                      </strong>
                      {stuck && task && (
                        <span className="change-options">
                          <button className="text-button" onClick={() => onEditTask(task)}>
                            Dời deadline
                          </button>
                          <button className="text-button" onClick={onOpenSettings}>
                            Thêm giờ học / tăng giới hạn
                          </button>
                        </span>
                      )}
                      {/* Kept last: the stylesheet formats the duration as the last span. */}
                      <span>
                        <Clock size={13} />
                        {duration(s.minutes)}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="simulation-notice">
                <WarningCircle size={20} />
                <p>
                  {unscheduled.length
                    ? "Một số phiên không còn chỗ trước deadline. Bạn có thể dời deadline, thêm khung giờ học hoặc tăng giới hạn ngày rồi xem lại; hoặc áp dụng và đưa các phiên đó về mục Chưa xếp lịch để tự sắp xếp sau."
                    : "Phương án giữ khung giờ học, lịch bận, thời gian nghỉ, giới hạn mỗi ngày và deadline. Chỉ áp dụng khi bạn thấy phù hợp."}
                </p>
              </div>
              <div className="form-actions">
                <button className="button" onClick={() => setResult(null)}>
                  Giữ lịch hiện tại
                </button>
                {unscheduled.length > 0 ? (
                  <button className="button dark" disabled={busy} onClick={() => apply(true)}>
                    Áp dụng, đưa {unscheduled.length} phiên về Chưa xếp lịch
                    <Check size={17} />
                  </button>
                ) : (
                  <button className="button dark" disabled={busy} onClick={() => apply(false)}>
                    Áp dụng phương án
                    <Check size={17} />
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
