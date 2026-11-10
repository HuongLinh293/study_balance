import { useState } from "react";
import {
  MagnifyingGlass,
  SlidersHorizontal,
  ArrowUpRight,
  BookOpen,
  PencilSimple,
  Plus,
} from "@phosphor-icons/react";
import {
  Heading,
  AddButton,
  TaskRow,
  EmptyState,
} from "../../components/Shared";
import {
  duration,
  type Subject,
  type Task,
} from "../../data/state";
export function TasksPage({
  tasks,
  subjects,
  onAdd,
  onTask,
  onToggle,
  initialSubject = "all",
}: {
  tasks: Task[];
  subjects: Subject[];
  onAdd: () => void;
  onTask: (t: Task) => void;
  onToggle: (id: string) => void;
  initialSubject?: string;
}) {
  const [filter, setFilter] = useState("open");
  const [subject, setSubject] = useState(initialSubject);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("due");
  const shown = tasks
    .filter(
      (t) =>
        (filter === "all" || (filter === "done" ? t.done : !t.done)) &&
        (subject === "all" || t.subject === subject) &&
        t.title.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")),
    )
    .sort((a, b) =>
      sort === "due" ? a.due.localeCompare(b.due) : b.minutes - a.minutes,
    );
  return (
    <>
      <Heading
        eyebrow="DỌN GỌN NHỮNG ĐIỀU CẦN LÀM"
        title="Việc đâu, vào đấy."
        description="Mọi bài tập, ý tưởng và deadline. Cùng ở một nơi."
      >
        <AddButton onClick={onAdd} />
      </Heading>
      <div className="task-summary">
        <div>
          <span className="summary-number">
            {tasks
              .filter((t) => !t.done)
              .length.toString()
              .padStart(2, "0")}
          </span>
          <span>việc đang chờ bạn</span>
        </div>
        <div>
          <span className="summary-number">
            {duration(
              tasks.filter((t) => !t.done).reduce((a, t) => a + t.minutes, 0),
            )}
          </span>
          <span>thời gian dự kiến</span>
        </div>
        <div>
          <span className="summary-number">
            {tasks
              .filter((t) => t.done)
              .length.toString()
              .padStart(2, "0")}
          </span>
          <span>việc đã hoàn thành</span>
        </div>
        <span className="summary-doodle" aria-hidden="true">
          <BookOpen size={52} weight="duotone" />
        </span>
      </div>
      <div className="task-toolbar">
        <div className="segmented">
          {[
            ["open", "Đang thực hiện"],
            ["done", "Đã hoàn thành"],
            ["all", "Tất cả"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={filter === id}
              className={filter === id ? "active" : ""}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <label className="search-box">
            <MagnifyingGlass size={17} />
            <input
              aria-label="Tìm công việc"
              placeholder="Tìm công việc…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label className="select-inline">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Lọc môn học"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              <option value="all">Tất cả môn học</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.short}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <section className="task-table paper-grid">
        <div className="table-heading">
          <span>{shown.length} CÔNG VIỆC</span>
          <label>
            Sắp xếp:{" "}
            <select
              aria-label="Sắp xếp công việc"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="due">Deadline gần nhất</option>
              <option value="duration">Thời lượng dài nhất</option>
            </select>
          </label>
        </div>
        {shown.length ? (
          shown.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              subjects={subjects}
              onToggle={() => onToggle(t.id)}
              onOpen={() => onTask(t)}
            />
          ))
        ) : (
          <EmptyState
            title={
              tasks.length
                ? "Chưa có công việc phù hợp."
                : "Bạn chưa có công việc nào."
            }
            text={
              tasks.length
                ? "Thử thay đổi bộ lọc hoặc thêm một việc mới."
                : "Ghi lại bài tập, deadline hoặc việc cần ôn đầu tiên."
            }
            action="Thêm công việc"
            onAction={onAdd}
          />
        )}
      </section>
      <p className="quiet-hint">
        Một danh sách vừa đủ, một ngày nhẹ hơn.
        <ArrowUpRight size={16} />
      </p>
    </>
  );
}
export function SubjectsPage({
  tasks,
  subjects,
  onSelect,
  onAdd,
  onEdit,
}: {
  tasks: Task[];
  subjects: Subject[];
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (subject: Subject) => void;
}) {
  return (
    <>
      <Heading
        eyebrow="MÔN HỌC CỦA BẠN"
        title="Mỗi môn, một hành trình."
        description="Gom công việc và tiến độ theo từng môn học."
      >
        <button className="button dark" onClick={onAdd}>
          <Plus size={18} />
          Thêm môn học
        </button>
      </Heading>
      <div className="subject-grid">
        {subjects.map((s, i) => {
          const related = tasks.filter((t) => t.subject === s.id);
          const done = related.filter((t) => t.done).length;
          return (
            <article className={`subject-card ${s.color}`} key={s.id}>
              <div className="subject-top">
                <span>MÔN {String(i + 1).padStart(2, "0")}</span>
                <button
                  className="icon-button subject-edit"
                  aria-label={`Sửa môn ${s.name}`}
                  onClick={() => onEdit(s)}
                >
                  <PencilSimple size={19} />
                </button>
              </div>
              <BookOpen size={40} weight="duotone" />
              <h2>
                <button
                  className="subject-card-link"
                  onClick={() => onSelect(s.id)}
                >
                  {s.name}
                </button>
              </h2>
              <p>
                {[s.teacher, s.credits ? `${s.credits} tín chỉ` : ""]
                  .filter(Boolean)
                  .join(" · ") || "Bấm để xem công việc của môn này"}
              </p>
              <div className="subject-progress">
                <span
                  style={{
                    width: `${(done / Math.max(1, related.length)) * 100}%`,
                  }}
                />
              </div>
              <div className="subject-card-footer">
                <span>{related.length - done} việc cần làm</span>
                <span>
                  {done}/{related.length} hoàn thành
                  <ArrowUpRight size={14} />
                </span>
              </div>
            </article>
          );
        })}
        <button className="subject-card subject-add" onClick={onAdd}>
          <Plus size={32} />
          <h2>{subjects.length ? "Thêm môn học" : "Thêm môn học đầu tiên"}</h2>
          <p>Đặt tên, chọn màu và gom công việc theo môn.</p>
        </button>
      </div>
    </>
  );
}
