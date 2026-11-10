import { useSave } from "../../hooks/useSave";
import { useState } from "react";
import { ArrowRight, Trash } from "@phosphor-icons/react";
import { Modal } from "../../components/Shared";
import { tones, type Subject, type Tone } from "../../data/state";

export function SubjectForm({
  subject,
  taskCount,
  onClose,
  onSave,
  onDelete,
}: {
  subject?: Subject;
  taskCount: number;
  onClose: () => void;
  onSave: (subject: Subject) => Promise<boolean>;
  onDelete: () => void;
}) {
  const { saving, saveError, save, closeWhenIdle } = useSave();
  const [id] = useState(() => subject?.id ?? crypto.randomUUID());
  const [name, setName] = useState(subject?.name ?? "");
  const [short, setShort] = useState(subject?.short ?? "");
  const [color, setColor] = useState<Tone>(subject?.color ?? "pink");
  const [teacher, setTeacher] = useState(subject?.teacher ?? "");
  const [credits, setCredits] = useState(subject?.credits ?? 0);
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <Modal title="Xóa môn học này?" onClose={() => setConfirming(false)}>
        <p className="modal-intro">
          {taskCount
            ? `${taskCount} công việc của môn này sẽ chuyển sang nhóm “Chung”. Công việc và lịch học không bị xóa.`
            : "Môn học chưa có công việc nào."}
        </p>
        <div className="form-actions">
          <button className="button" onClick={() => setConfirming(false)}>
            Giữ lại
          </button>
          <button className="button dark" onClick={onDelete}>
            Xóa môn học
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal
      title={subject ? "Chỉnh sửa môn học" : "Thêm một môn học"}
      onClose={closeWhenIdle(onClose)}
    >
      <form
        aria-busy={saving}
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void save(() => onSave({
            id,
            name: name.trim(),
            short: short.trim() || name.trim(),
            color,
            teacher: teacher.trim(),
            credits: Math.max(0, credits || 0),
          }));
        }}
      >
        <label>
          Tên môn học
          <input
            disabled={saving}
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Cơ sở dữ liệu"
          />
        </label>
        <label>
          Tên ngắn (không bắt buộc)
          <input
            disabled={saving}
            maxLength={30}
            value={short}
            onChange={(e) => setShort(e.target.value)}
            placeholder="Hiển thị trên lịch và danh sách"
          />
        </label>
        <fieldset className="color-options">
          <legend>Màu</legend>
          {tones.map((t) => (
            <label key={t.id}>
              <input
            disabled={saving}
                type="radio"
                name="subject-color"
                value={t.id}
                checked={color === t.id}
                onChange={() => setColor(t.id)}
              />
              <i className={`subject-dot ${t.id}`} />
              {t.label}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <label>
            Giảng viên
            <input
            disabled={saving}
              maxLength={60}
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
            />
          </label>
          <label>
            Số tín chỉ
            <input
            disabled={saving}
              type="number"
              min={0}
              max={20}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
            />
          </label>
        </div>
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <div className="form-actions">
          {subject && (
            <button
              type="button"
              className="button danger"
              disabled={saving}
              onClick={() => setConfirming(true)}
            >
              <Trash size={17} />
              Xóa
            </button>
          )}
          <button type="button" className="button" onClick={closeWhenIdle(onClose)} disabled={saving}>
            Để sau
          </button>
          <button className="button dark" type="submit" disabled={saving}>
            {saving ? "Đang lưu…" : subject ? "Lưu thay đổi" : "Thêm môn học"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
