import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Plus,
  X,
  Clock,
  Flag,
  ArrowRight,
} from "@phosphor-icons/react";
import {
  subjectFor,
  dueLabel,
  duration,
  type Subject,
  type Task,
} from "../data/state";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog
      ?.querySelector<HTMLInputElement>(
        "input:not([type=radio]):not([type=checkbox]), textarea",
      )
      ?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Đóng" onClick={onClose}>
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </header>
  );
}
export function SectionTitle({
  title,
  label,
  onClick,
}: {
  title: string;
  label?: string;
  onClick?: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {label && (
        <button className="text-button" onClick={onClick}>
          {label}
          <ArrowUpRight size={15} />
        </button>
      )}
    </div>
  );
}
export function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="button dark" onClick={onClick}>
      <Plus size={18} />
      Thêm công việc
    </button>
  );
}
export function TaskRow({
  task,
  subjects,
  onToggle,
  onOpen,
}: {
  task: Task;
  subjects: Subject[];
  onToggle: () => void;
  onOpen: () => void;
}) {
  const subject = subjectFor(subjects, task.subject);
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className={`checkbox ${task.done ? "checked" : ""}`}
        aria-label={`${task.done ? "Mở lại" : "Hoàn thành"} ${task.title}`}
        aria-pressed={task.done}
        onClick={onToggle}
      >
        {task.done && <Check size={13} weight="bold" />}
      </button>
      <button className="task-main" onClick={onOpen}>
        <span className="task-name">{task.title}</span>
        <span className="task-meta">
          <i className={`subject-dot ${subject.color}`} />
          {subject.short}
          <span className="meta-separator">/</span>
          <Clock size={12} />
          {duration(task.minutes)}
        </span>
      </button>
      {task.priority === "high" && !task.done && (
        <Flag className="priority-flag" size={15} aria-label="Ưu tiên cao" />
      )}
      <span className="due-label">{dueLabel(task.due)}</span>
      <button
        className="icon-button row-open"
        aria-label={`Chi tiết ${task.title}`}
        onClick={onOpen}
      >
        <ArrowUpRight size={18} />
      </button>
    </div>
  );
}
export function EmptyState({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <Check size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="button" onClick={onAction}>
          {action}
          <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}
