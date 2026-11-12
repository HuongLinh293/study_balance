# Kết quả kiểm thử planner trong worker threads — 12/11/2026

Môi trường: macOS, Node.js 24 (unit test); Docker Compose với 2 bản sao planning-service, mỗi bản 2 worker (chạy thật). Xem [cơ chế](../processes-threads.md).

## Đo trước khi làm

`generatePlan` chạy trên luồng chính, 7 khung rảnh mỗi tuần, hạn rải trong 60 ngày:

| Số công việc | Thời gian | Phiên xếp được |
|---|---|---|
| 20 | 83 ms | 241 |
| 100 | 283 ms | 1167 |
| 300 | 745 ms | 1324 |
| 500 | 1129 ms | 1321 |

## Kiểm thử

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Kết quả qua worker giống hệt chạy trực tiếp (40 công việc: từng phiên, phút đã xếp, phần thiếu) | Đạt |
| 2 | Khoảng chặn event loop dài nhất khi tính 500 công việc | Luồng chính **1612 ms**, worker **12 ms** |
| 3 | Hai job 300 ms trên 2 worker chạy song song | Xong cùng lúc (< 550 ms tổng) |
| 4 | Hàng đợi: 1 worker, `maxQueue` 1 → job thứ ba bị từ chối `PoolBusyError` | Đạt; hai job đầu vẫn có kết quả |
| 5 | Job treo vô hạn → `PoolTimeoutError`, worker được thay, job sau chạy được | Đạt |
| 6 | Worker crash (`process.exit`) → chỉ job đó lỗi, worker được thay | Đạt |
| 7 | Lỗi do job báo về được chuyển nguyên; worker giữ nguyên | Đạt |
| 8 | `npm test`, `npm run typecheck` | Đạt toàn bộ, typecheck sạch |
| 9 | `npm run test:e2e` sau khi build lại planning-service | 16/16 bước đạt |
| 10 | Chạy thật qua gateway HTTPS: 300 công việc, 4 lần đề xuất song song (mỗi lần xếp 1073 phiên, 1.2–1.5 s), đồng thời gọi liên tục `GET /study-sessions` | 198 request: p50 6 ms, p95 21 ms, max 42 ms, 0 lỗi |
| 11 | Metric `studybalance_planner_jobs_total` trên Prometheus | Ghi đúng job `generate`/`simulate` thành công |

Chưa kiểm thử với hệ thống thật: `PLANNER_BUSY` và `PLANNER_TIMEOUT` qua API (đã có unit test cho cơ chế của pool).
