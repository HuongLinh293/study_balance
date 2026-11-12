import { useState } from "react";
import {
  ArrowUpRight,
  Clock,
  CheckCircle,
  Plant,
  Sparkle,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Heading, SectionTitle } from "../../components/Shared";
import {
  duration,
  minutesBySubject,
  type AppState,
} from "../../data/state";
import { messageFor } from "../../lib/api";
import { fetchSummary, keys } from "../../lib/studyData";
const EMPTY = {
  labels: ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
  values: [0, 0, 0, 0, 0, 0, 0],
  current: -1,
  streak: 0,
  completedTasks: 0,
  totalTasks: 0,
  bySubject: [],
};
export function AnalyticsPage({ state }: { state: AppState }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  // Analytics is built from events, so it can trail the latest change by a moment.
  const summary = useQuery({
    queryKey: keys.summary(period),
    queryFn: () => fetchSummary(period),
  });
  const data = summary.data ?? EMPTY;
  const { labels: days, values, current } = data;
  const total = values.reduce((a, b) => a + b, 0);
  const completed = data.completedTasks;
  const streak = data.streak;
  const plannedBySubject = minutesBySubject(data.bySubject, state.subjects);
  const maxPlanned = Math.max(1, ...plannedBySubject.map((p) => p.minutes));
  const top = plannedBySubject[0];
  return (
    <>
      <Heading
        eyebrow="NHÌN LẠI ĐỂ ĐI XA HƠN"
        title="Tiến bộ, theo cách của bạn."
        description="Không cần so sánh với ai. Những bước nhỏ này đều đáng ghi nhận."
      >
        <div className="segmented">
          <button
            className={period === "week" ? "active" : ""}
            onClick={() => setPeriod("week")}
          >
            Tuần này
          </button>
          <button
            className={period === "month" ? "active" : ""}
            onClick={() => setPeriod("month")}
          >
            Tháng này
          </button>
        </div>
      </Heading>
      <div className="analytics-stats">
        <section className="yellow">
          <Clock size={22} />
          <span>Thời gian tập trung</span>
          <strong>{duration(total)}</strong>
          <small>
            Từ các phiên đã ghi nhận{" "}
            {period === "week" ? "trong tuần này" : "trong tháng này"}
          </small>
        </section>
        <section className="pink">
          <CheckCircle size={22} />
          <span>Công việc hoàn thành</span>
          <strong>
            {completed}
            <small> / {data.totalTasks}</small>
          </strong>
          <small>Trong danh sách công việc hiện tại</small>
        </section>
        <section className="green">
          <Plant size={22} />
          <span>Nhịp học đều đặn</span>
          <strong>
            {streak} <small>ngày</small>
          </strong>
          <small>
            {streak ? "Chuỗi ngày học liên tiếp" : "Học một phiên để bắt đầu chuỗi"}
          </small>
        </section>
      </div>
      <div className="analytics-grid">
        <section className="chart-panel paper-grid">
          <SectionTitle title="Thời gian dành cho việc học" />
          <div className="chart-legend">
            <span className="subject-dot pink" />
            Thời gian thực tế (phút)
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={days
              .map((d, i) => `${d}: ${values[i]} phút`)
              .join(", ")}
          >
            {values.map((v, i) => (
              <div className="bar-column" key={i}>
                <span>{v}p</span>
                <div
                  className={`bar ${i === current ? "pink" : "blue"}`}
                  style={{
                    height: `${Math.max(3, (v / Math.max(1, ...values)) * 190)}px`,
                  }}
                />
                <small>{days[i]}</small>
              </div>
            ))}
          </div>
          <p className="chart-caption">
            {total
              ? "Có ngày học nhiều, có ngày học ít. Giữ một nhịp phù hợp với bạn."
              : "Chưa có phiên học nào được ghi nhận trong khoảng này."}
          </p>
        </section>
        <section className="subject-distribution">
          <SectionTitle title="Theo từng môn học" />
          {plannedBySubject.map(({ subject: s, minutes }) => {
            return (
              <div className="distribution-row" key={s.id}>
                <div>
                  <span>
                    <i className={`subject-dot ${s.color}`} />
                    {s.short}
                  </span>
                  <strong>{duration(minutes)}</strong>
                </div>
                <div className="distribution-track">
                  <span
                    className={s.color}
                    style={{ width: `${(minutes / maxPlanned) * 100}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p>
            {summary.error
              ? messageFor(summary.error)
              : plannedBySubject.length
                ? `Thời gian thực tế đã học theo môn trong ${period === "week" ? "tuần" : "tháng"} này.`
                : "Chưa có phiên học nào được ghi nhận trong khoảng này."}
          </p>
        </section>
      </div>
      <section className="weekly-reflection">
        <Sparkle size={26} />
        <div>
          <h3>
            {period === "week"
              ? "Một điều đáng nhớ của tuần này"
              : "Một điều đáng nhớ của tháng này"}
          </h3>
          <p>
            {total
              ? `Bạn đã học ${duration(total)}${top?.minutes ? `, dành nhiều thời gian nhất cho ${top.subject.short}` : ""}. Hãy thử chia những việc lớn thành các phiên ngắn hơn.`
              : "Chưa có phiên học nào được ghi nhận. Bắt đầu với một phiên ngắn từ Bảng kế hoạch nhé."}
          </p>
        </div>
        <ArrowUpRight size={28} />
      </section>
    </>
  );
}
