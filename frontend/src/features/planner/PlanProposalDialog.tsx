import { useEffect, useState } from "react";
import { Check, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { EmptyState, Modal } from "../../components/Shared";
import { duration, subjectFor, time, type AppState, type Task } from "../../data/state";
import { addDays, shortDate, weekdayName } from "../../data/dates";
import { messageFor } from "../../lib/api";
import { plansApi, type PlanProposal } from "../../lib/studyData";
import { remainingToSchedule } from "../../data/schedule";

/**
 * Asks Planning for a proposal covering every unscheduled task, shows it with
 * any shortfall, and only writes sessions when the user confirms.
 */
export function PlanProposalDialog({
  state,
  onClose,
  onApplied,
  onEditTask,
  onOpenSettings,
}: {
  state: AppState;
  onClose: () => void;
  onApplied: (message: string) => void;
  onEditTask: (task: Task) => void;
  onOpenSettings: () => void;
}) {
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      // Tasks this browser sees as needing time; Planning waits until it has received them all.
      const expected = state.tasks
        .filter((t) => !t.done && remainingToSchedule(state, t) > 0)
        .map((t) => t.id);
      setProposal(await plansApi.generate(expected));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void generate();
  }, []);
  const taskOf = (id: string) => state.tasks.find((t) => t.id === id);
  const byDate = new Map<string, PlanProposal["proposed"]>();
  for (const s of proposal?.proposed ?? []) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const when = (date: string) =>
    date === proposal?.today
      ? "Hôm nay"
      : proposal && date === addDays(proposal.today, 1)
        ? "Ngày mai"
        : `${weekdayName(date)}, ${shortDate(date)}`;
  const missing = proposal?.shortfalls.reduce((a, s) => a + s.missingMinutes, 0) ?? 0;
  return (
    <Modal title="Gợi ý lịch học" onClose={onClose} wide>
      <p className="modal-intro">
        Chia các việc còn lại thành phiên học theo deadline, khung giờ rảnh và giới hạn mỗi ngày. Lịch chỉ thay đổi khi bạn
        đồng ý.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && !proposal && <p className="loading-text">Đang tính phương án…</p>}
      {proposal && proposal.neededMinutes === 0 && (
        <EmptyState
          title="Mọi công việc đã có đủ phiên học."
          text="Thêm công việc mới hoặc bỏ bớt phiên để nhận gợi ý."
        />
      )}
      {proposal && proposal.neededMinutes > 0 && (
        <div className="plan-proposal">
          <div className="plan-summary">
            <span className="badge yellow">
              <Sparkle size={14} />
              Bản đề xuất
            </span>
            <strong>
              Xếp được {duration(proposal.placedMinutes)} / {duration(proposal.neededMinutes)} cần học
            </strong>
            <span>{proposal.proposed.length} phiên mới</span>
          </div>
          {proposal.shortfalls.length > 0 && (
            <div className="plan-shortfalls" role="alert">
              <WarningCircle size={20} />
              <div>
                <strong>Thiếu {duration(missing)} trước deadline.</strong>
                <p>Không xếp quá lịch rảnh. Bạn có thể bổ sung thời gian theo một trong các cách sau:</p>
                <ul>
                  {proposal.shortfalls.map((s) => {
                    const task = taskOf(s.taskId);
                    return (
                      <li key={s.taskId}>
                        <span>
                          <strong>{task?.title ?? "Công việc"}</strong>: thiếu {duration(s.missingMinutes)} trước hạn{" "}
                          {shortDate(s.dueDate)}
                        </span>
                        {task && (
                          <button className="text-button" onClick={() => onEditTask(task)}>
                            Dời deadline / giảm thời lượng
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button className="text-button" onClick={onOpenSettings}>
                  Thêm khung giờ học hoặc tăng giới hạn mỗi ngày
                </button>
              </div>
            </div>
          )}
          <div className="plan-days">
            {[...byDate].map(([date, list]) => (
              <section key={date}>
                <h3>
                  {when(date)}
                  <small>{duration(list.reduce((a, s) => a + s.minutes, 0))}</small>
                </h3>
                {list.map((s) => {
                  const task = taskOf(s.taskId);
                  const subject = subjectFor(state.subjects, task?.subject ?? "");
                  return (
                    <div className="plan-row" key={s.id}>
                      <span>
                        {time(s.startMinute)} – {time(s.startMinute + s.minutes)}
                      </span>
                      <i className={`subject-dot ${subject.color}`} />
                      <strong>{task?.title ?? "Công việc"}</strong>
                      <small>{duration(s.minutes)}</small>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}
      <div className="form-actions">
        <button className="button" onClick={onClose}>
          Để sau
        </button>
        {error && (
          <button className="button" onClick={generate} disabled={busy}>
            Tính lại
          </button>
        )}
        <button
          className="button dark"
          disabled={busy || !proposal?.proposed.length}
          onClick={async () => {
            if (!proposal) return;
            setBusy(true);
            setError("");
            try {
              await plansApi.apply(proposal.id);
              onApplied(`Đã thêm ${proposal.proposed.length} phiên học vào lịch.`);
            } catch (err) {
              setError(messageFor(err));
              setProposal(null);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!proposal
            ? "Đang tính đề xuất…"
            : proposal.proposed.length
              ? `Thêm ${proposal.proposed.length} phiên vào lịch`
              : "Không có phiên mới"}
          <Check size={17} />
        </button>
      </div>
    </Modal>
  );
}
