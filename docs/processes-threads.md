# Tiến trình, luồng và tác vụ nền

Node.js chạy JavaScript trên một luồng (event loop) và đẩy I/O (MySQL, RabbitMQ, HTTP) cho libuv xử lý bất đồng bộ. Vì vậy một service phục vụ được nhiều request cùng lúc, miễn là không có đoạn tính toán nào giữ event loop quá lâu. Tài liệu này liệt kê các cơ chế StudyBalance dùng cho từng nhu cầu.

## Đa luồng: planner trong `worker_threads`

Thuật toán đề xuất kế hoạch và mô phỏng ([rules.ts](../services/planning-service/src/modules/sessions/rules.ts)) là tính toán thuần CPU. Với 500 công việc (giới hạn của API), nó chạy khoảng 1.1–1.6 giây. Nếu chạy trên event loop, trong khoảng đó bản sao planning-service không trả lời được request nào khác, kể cả healthcheck và sự kiện RabbitMQ.

Thuật toán vì vậy chạy trong một **worker pool** tự viết ([workerPool.ts](../services/planning-service/src/modules/planner/workerPool.ts), [worker.ts](../services/planning-service/src/modules/planner/worker.ts)):

| Cơ chế | Chi tiết |
|---|---|
| Số luồng cố định | `PLANNER_WORKERS`, mặc định `min(2, số CPU − 1)`; tạo khi có job đầu tiên |
| Truyền dữ liệu | `postMessage` (structured clone): luồng chính đọc DB, worker chỉ tính toán, không chia sẻ bộ nhớ |
| Hàng đợi có giới hạn | `PLANNER_MAX_QUEUE` (50). Đầy thì trả ngay `503 PLANNER_BUSY` thay vì dồn việc (backpressure) |
| Timeout | `PLANNER_TIMEOUT_MS` (10 s). Quá hạn: dừng worker, tạo worker mới, trả `503 PLANNER_TIMEOUT` |
| Worker chết | Chỉ job đang chạy lỗi; worker được thay thế trước job kế tiếp |
| Quan sát | `studybalance_planner_jobs_total{kind,outcome}`, `…_job_duration_seconds`, `…_planner_queue{state}`; log `planner_worker_started/replaced` |

Đo được (chi tiết trong [kết quả kiểm thử](test-results/2026-11-12-worker-threads.md)):

- 500 công việc: event loop bị chặn **1612 ms** khi chạy trên luồng chính, **12 ms** khi dùng worker. Kết quả tính toán giống hệt nhau.
- Chạy thật qua gateway: 4 lần đề xuất song song với 300 công việc (mỗi lần 1.2–1.5 s). Trong lúc đó các request khác tới planning-service có p95 21 ms, tối đa 42 ms, không lỗi.

## Xử lý bất đồng bộ

- Toàn bộ I/O dùng `async/await` qua `mysql2/promise`, `amqplib` và `fetch`. Không có lời gọi đồng bộ nào chặn event loop.
- Consumer RabbitMQ nhận tối đa 10 tin cùng lúc (`prefetch(10)`). Mỗi tin được xử lý trong transaction riêng, lấy từ pool 10 kết nối MySQL.
- Các bước không phụ thuộc nhau chạy song song (`Promise.all`), ví dụ khi tắt service và trong script kiểm thử.
- Thông báo đẩy tới trình duyệt qua Server-Sent Events: một kết nối mở lâu không tốn luồng nào ([sơ đồ 09](architecture/09-thong-bao-realtime.png)).

## Quản lý tiến trình

| Cơ chế | Ở đâu |
|---|---|
| Mỗi service là một tiến trình trong container riêng; task và planning chạy 2 bản sao | `docker-compose.yml` |
| Tự khởi động lại khi tiến trình chết (`restart: unless-stopped`) | mọi container chạy lâu dài |
| Healthcheck: chỉ nhận traffic khi `/ready` xác nhận được DB và broker | compose + [http.ts](../packages/service-kit/src/http.ts) |
| Tắt êm khi nhận SIGTERM/SIGINT: ngừng nhận request, đóng stream SSE, dừng relay/scheduler, đóng worker pool, broker, pool DB; quá 10 s thì thoát hẳn | `listen()` trong service-kit, `index.ts` từng service |
| Container chạy một lần rồi thoát: `replica-setup`, `gateway-cert` | compose |

Dùng Docker thay cho PM2/Supervisor vì mỗi service đã nằm trong container riêng. Docker vừa giám sát vừa khởi động lại tiến trình, và healthcheck gắn liền với việc định tuyến traffic.

## Lập lịch tác vụ

| Tác vụ | Chu kỳ | Chạy nhiều bản sao an toàn nhờ |
|---|---|---|
| Outbox relay: chuyển sự kiện sang RabbitMQ | 500 ms (`setTimeout` nối tiếp, không chồng lần) | `FOR UPDATE SKIP LOCKED` |
| Dọn outbox đã phát quá 7 ngày | khoảng mỗi giờ (theo số lần chạy relay) | câu `DELETE` idempotent |
| Lời nhắc khi sang ngày mới | 1 phút | khóa unique `(user_id, dedupe_key)` |
| Đồng bộ Google Calendar | kiểm tra mỗi phút, mỗi người dùng tối đa 5 phút một lần | `GET_LOCK('gcal:<user>')` |
| Sao lưu 5 database | `BACKUP_INTERVAL_SECONDS` (1 ngày), chạy ngay khi khởi động | một container duy nhất |

## Tác vụ nền

- **Hàng đợi retry của RabbitMQ:** handler lỗi thì tin vào `<queue>.retry` (TTL 5 s) rồi quay lại queue chính. Sau 5 lần thì vào `<queue>.dlq`.
- **Worker pool của planner:** như trên.
- **Seed replica và tạo chứng chỉ:** container chạy một lần mỗi khi `docker compose up`, và idempotent.

Không dùng Bull/Celery vì RabbitMQ đã có sẵn và lo được retry, độ trễ và DLQ cho tác vụ dựa trên sự kiện. Thêm Redis chỉ để chạy hàng đợi job là một thành phần nữa phải vận hành.

## Giới hạn

- Các scheduler `setInterval` chạy ở mọi bản sao. Việc này an toàn nhờ các khóa ở bảng trên, nhưng làm lặp lại công việc. Chưa có cơ chế chọn một bản sao duy nhất để chạy (leader election).
- Worker pool nằm trong từng tiến trình. Hai bản sao planning-service thì có tổng cộng tối đa 4 luồng tính toán.
