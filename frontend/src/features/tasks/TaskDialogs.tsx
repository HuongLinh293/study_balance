import { useSave } from "../../hooks/useSave";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  Flag,
  CalendarBlank,
  BookOpen,
  Trash,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "../../components/Shared";
import { fetchProgress } from "../../lib/studyData";
import {
  subjectFor,
  duration,
  time,
  type Session,
  type Subject,
  type Task,
} from "../../data/state";
import { addDays, fullDate, todayISO } from "../../data/dates";

export function TaskForm({
  subjects,
  onClose,
  onSave,
  task,
}: {
  subjects: Subject[];
  onClose: () => void;
  onSave: (task: Task) => Promise<boolean>;
  task?: Task;
}) {
  const { saving, saveError, save, closeWhenIdle } = useSave();
  const [id] = useState(() => task?.id ?? crypto.randomUUID());
  const [title, setTitle] = useState(task?.title ?? "");
  const [subject, setSubject] = useState(task?.subject ?? subjects[0]?.id ?? "");
  const [due, setDue] = useState(task?.due ?? addDays(todayISO(), 7));
  const [minutes, setMinutes] = useState(task?.minutes ?? 50);
  const [priority, setPriority] = useState<Task["priority"]>(
    task?.priority ?? "normal",
  );
  const [note, setNote] = useState(task?.note ?? "");
  const [error, setError] = useState("");
  return (
    <Modal
      title={task ? "Chỉnh sửa công việc" : "Một việc mới, một bước tiến."}
      onClose={closeWhenIdle(onClose)}
    >
      <p className="modal-intro">
        Ghi lại việc cần làm. Mình cùng dành thời gian cho nó.
      </p>
      <form
        aria-busy={saving}
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            setError("Hãy nhập tên công việc.");
            return;
          }
          void save(() => onSave({
            id,
            title: title.trim(),
            subject,
            due,
            minutes,
            priority,
            note,
            done: task?.done ?? false,
            steps: task?.steps ?? [],
            stepsDone: task?.stepsDone ?? [],
            version: task?.version ?? 1,
          }));
        }}
      >
        <label>
          Tên công việc
          <input
            disabled={saving}
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Hoàn thành báo cáo cơ sở dữ liệu"
          />
        </label>
        <label>
          Môn học
          <select disabled={saving} value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Chung (chưa phân môn)</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Hạn hoàn thành
            <input
            disabled={saving}
              type="date"
              required
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <label>
            Thời lượng còn lại (phút)
            <input
            disabled={saving}
              type="number"
              required
              min={0}
              max={1440}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          Mức ưu tiên
          <select
            disabled={saving}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Task["priority"])}
          >
            <option value="normal">Bình thường</option>
            <option value="high">Ưu tiên cao</option>
          </select>
        </label>
        <label>
          Ghi chú
          <textarea
            disabled={saving}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tài liệu, ý tưởng hoặc điều cần nhớ…"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="form-actions">
          <button type="button" className="button" onClick={closeWhenIdle(onClose)} disabled={saving}>
            Để sau
          </button>
          <button className="button dark" type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : task ? "Lưu thay đổi" : "Thêm công việc"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TaskDetail({
  task,
  subjects,
  sessionCount,
  doneSessions,
  onClose,
  onEdit,
  onToggle,
  onDelete,
  onApplyProgress,
  onToggleStep,
}: {
  task: Task;
  subjects: Subject[];
  /** Planned sessions that deleting the task cancels; finished ones stay as history. */
  sessionCount: number;
  doneSessions: Session[];
  onClose: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onApplyProgress: (session: Session) => void;
  onToggleStep: (index: number, done: boolean) => void;
}) {
  const subject = subjectFor(subjects, task.subject);
  const [confirming, setConfirming] = useState(false);
  const progress = useQuery({
    queryKey: ["progress", task.id],
    queryFn: () => fetchProgress(task.id),
    enabled: doneSessions.length > 0,
  });
  const applied = new Set(progress.data?.items.map((p) => p.sessionId));
  if (confirming)
    return (
      <Modal title="Xóa công việc này?" onClose={() => setConfirming(false)}>
        <p className="modal-intro">
          “{task.title}”
          {sessionCount
            ? ` và ${sessionCount} phiên chưa học trong lịch sẽ bị xóa. Phiên đã học được giữ trong thống kê.`
            : " sẽ bị xóa."}{" "}
          Không thể hoàn tác.
        </p>
        <div className="form-actions">
          <button className="button" onClick={() => setConfirming(false)}>
            Giữ lại
          </button>
          <button className="button dark" onClick={onDelete}>
            Xóa công việc
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title="Chi tiết công việc" onClose={onClose}>
      <span className={`badge ${subject.color}`}>
        <BookOpen size={13} />
        {subject.short}
      </span>
      <h3 className="detail-title">{task.title}</h3>
      <div className="detail-facts">
        <span>
          <CalendarBlank size={18} />
          {fullDate(task.due)}
        </span>
        <span>
          <Clock size={18} />
          {duration(task.minutes)} còn lại
        </span>
        <span>
          <Flag size={18} />
          {task.priority === "high" ? "Ưu tiên cao" : "Bình thường"}
        </span>
      </div>
      <p className="detail-note">
        {task.note || "Chưa có ghi chú cho công việc này."}
      </p>
      {task.steps.length > 0 && (
        <>
          <h4>
            Các bước nhỏ{" "}
            <small>
              {task.stepsDone.filter(Boolean).length}/{task.steps.length} xong
            </small>
          </h4>
          <ol className="step-list">
            {task.steps.map((s, i) => (
              <li key={`${i}-${s}`} className={task.stepsDone[i] ? "done" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={task.stepsDone[i] ?? false}
                    onChange={(e) => onToggleStep(i, e.target.checked)}
                  />
                  <span>{s}</span>
                </label>
              </li>
            ))}
          </ol>
        </>
      )}
      {doneSessions.length > 0 && (
        <>
          <h4>Phiên đã học</h4>
          <ul className="done-sessions">
            {doneSessions.map((s) => (
              <li key={s.id}>
                <span>
                  {fullDate(s.date)} · {time(s.start)} · {duration(s.actualMinutes ?? s.minutes)}
                </span>
                {progress.data &&
                  (applied.has(s.id) ? (
                    <small>Đã trừ vào thời lượng</small>
                  ) : (
                    <button className="text-button" onClick={() => onApplyProgress(s)}>
                      Trừ vào thời lượng còn lại
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="form-actions">
        <button className="button danger" onClick={() => setConfirming(true)}>
          <Trash size={17} />
          Xóa
        </button>
        <button className="button" onClick={onEdit}>
          Chỉnh sửa
        </button>
        <button className="button dark" onClick={onToggle}>
          <CheckCircle size={18} />
          {task.done ? "Mở lại công việc" : "Đánh dấu hoàn thành"}
        </button>
      </div>
    </Modal>
  );
}
