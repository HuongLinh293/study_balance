# StudyBalance API

Tất cả route đi qua gateway: `/api/<service>/…` (Nginx cổng `GATEWAY_PORT`, hoặc Vite proxy khi dev). Ví dụ `POST /api/task/tasks`.

## Quy ước chung

- JSON, camelCase. Ngày dạng `YYYY-MM-DD` theo múi giờ của người dùng; giờ trong ngày là số phút từ 00:00 (`startMinute: 540` = 09:00).
- Xác thực: `Authorization: Bearer <accessToken>` (JWT HS256, 15 phút). **Mỗi service tự kiểm tra token**, không tin gateway. Dữ liệu luôn lọc theo `userId` trong token; truy cập dữ liệu người khác trả 404.
- Lỗi: `{ "error": { "code": "…", "message": "…", "details"?: […] } }`. Mã thường gặp: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `NOT_FOUND` 404, `VERSION_CONFLICT` 409, mã quy tắc lập lịch 422.
- Tạo idempotent: `POST /subjects`, `/tasks`, `/study-sessions` nhận `id` (UUID) do client sinh. Gửi lại cùng `id` trả bản ghi đã có (200) thay vì tạo bản thứ hai.
- Optimistic concurrency: `PATCH` nhận `version` tùy chọn. Nếu dữ liệu đã đổi ở nơi khác thì trả 409 `VERSION_CONFLICT` kèm `details.current`.
- Mỗi response có `X-Correlation-Id` (nhận lại từ request nếu client gửi); giá trị này đi theo sự kiện phát ra.
- `GET /health`: liveness. `GET /ready`: kiểm tra DB và broker. `GET /metrics`: Prometheus. `/ready` và `/metrics` chỉ dùng nội bộ, gateway chặn. Mỗi response có `X-Served-By` (bản sao đã trả lời).

## User — `/api/user`

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/auth/register` | `{email, password (≥8), name}` → 201 `{accessToken, expiresIn, user}` + cookie `sb_refresh` |
| POST | `/auth/login` | `{email, password}`. Sai quá 10 lần/15 phút theo IP+email → 429 |
| POST | `/auth/refresh` | Cookie `sb_refresh` + header `X-StudyBalance-Client: web`. Xoay vòng token; dùng lại token cũ sẽ thu hồi cả họ token |
| POST | `/auth/logout` | Như trên; thu hồi họ token, xóa cookie |
| POST | `/auth/change-password` | Bearer. `{currentPassword, newPassword (≥8)}` → phiên mới cho trình duyệt hiện tại; mọi refresh token khác bị thu hồi. Sai mật khẩu → 400 `WRONG_PASSWORD` |
| GET | `/me` | `{id, email, name, note, version, preferences}` |
| PATCH | `/me` | `{version?, name?, note?, preferences?: {sessionMinutes, restMinutes, dailyLimitMinutes, reminders, timezone}}` |
| GET | `/me/availability` | `{version, windows: [{weekday 0=T2…6=CN, startMinute, endMinute}], busy: [{id, date, startMinute, endMinute, label}]}` (lịch bận từ hôm qua trở đi) |
| PUT | `/me/availability` | `{version?, windows}`; các khung cùng ngày không được chồng nhau, tối đa 6 khung/ngày. Mặc định 08:00–12:00 và 13:10–18:00 mỗi ngày |
| POST | `/me/busy-periods` | `{id?, date, startMinute, endMinute, label?}`; ngày nghỉ = `0–1440`. Từ hôm nay đến 1 năm tới, tối đa 200 khoảng sắp tới |
| DELETE | `/me/busy-periods/:id` | |

Refresh token là chuỗi ngẫu nhiên 32 byte, chỉ lưu SHA-256. Cookie `HttpOnly; SameSite=Strict; Path=/api/user/auth`, `Secure` khi `COOKIE_SECURE=true`. Mật khẩu băm scrypt.

## Task — `/api/task`

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/subjects` | `{items: [{id, name, short, color, teacher, credits}]}` |
| POST | `/subjects` | `{id?, name, short?, color: pink\|blue\|yellow\|green, teacher?, credits?}` |
| PATCH / DELETE | `/subjects/:id` | Xóa môn: công việc của môn chuyển sang `subjectId: null` (phát `TaskUpdated`) |
| GET | `/tasks?status=open\|done\|all&limit&offset` | `{items, nextOffset}` |
| POST | `/tasks` | `{id?, title, subjectId?, dueDate, remainingMinutes, priority?, note?, steps?: string[]}` |
| GET / PATCH / DELETE | `/tasks/:id` | Task: `{id, title, subjectId, dueDate, remainingMinutes, priority, done, note, steps, version}` |
| PATCH | `/tasks/:id/progress` | `{minutes, sessionId?}` → `{task, applied}`. Mỗi `sessionId` chỉ trừ một lần |
| GET | `/tasks/:id/progress` | `{items: [{sessionId, minutes, createdAt}]}`. Giao diện dùng để biết phiên đã học nào chưa trừ vào thời lượng |

## Planning — `/api/planning`

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/study-sessions?from&to` | Tối đa 93 ngày. Session: `{id, taskId, date, startMinute, minutes, status: planned\|done, actualMinutes, version}` |
| POST | `/study-sessions` | `{id?, taskId, date, startMinute, minutes}` |
| PATCH | `/study-sessions/:id` | `{version?, date?, startMinute?, minutes?}`; chỉ phiên `planned` |
| DELETE | `/study-sessions/:id` | Chỉ phiên `planned`; phiên đã học giữ làm lịch sử |
| POST | `/study-sessions/:id/finish` | `{actualMinutes}`; gọi lại trả kết quả cũ. **Không** trừ thời lượng công việc: client gọi tiếp `PATCH /api/task/tasks/:id/progress` với `sessionId` |
| POST | `/simulations` | `{scenario: afternoon\|whole}` (hôm nay) hoặc `{date, startMinute, endMinute, label?}` (đến 30 ngày tới) → `{id, busy, changed, moved, unscheduled: [{…, reason: deadline\|no_time}], feasible, status}`; không đổi lịch |
| GET | `/simulations/:id` | |
| POST | `/simulations/:id/apply` | `{dropUnscheduled?}`. 409 `SIMULATION_STALE` nếu phiên, thiết lập hoặc lịch rảnh đã đổi, đã sang ngày khác hoặc preview quá 30 phút; 422 `SIMULATION_INFEASIBLE` nếu còn phiên chưa xếp được mà không chọn `dropUnscheduled` (phiên bị bỏ trả thời lượng về mục chưa xếp). Client tự lưu khoảng bận qua `POST /me/busy-periods` *sau khi* áp dụng |
| POST | `/plans/generate` | `{taskIds?}` → `{id, today, proposed, shortfalls: [{taskId, dueDate, neededMinutes, missingMinutes}], neededMinutes, placedMinutes}`; không đổi lịch. Nếu có `taskIds` mà Planning chưa nhận đủ thì trả `TASK_NOT_SYNCED` |
| POST | `/plans/:id/apply` | 409 `PLAN_STALE` nếu công việc, phiên, thiết lập hoặc lịch rảnh đã đổi sau khi đề xuất |

Quy tắc xếp phiên (422): `TASK_DONE`, `INVALID_DURATION` (≥5 phút, không vượt phần chưa xếp), `PAST_DATE`, `PAST_TIME`, `AFTER_DEADLINE`, `BUSY_PERIOD`, `OUTSIDE_AVAILABILITY` (phiên phải nằm trọn trong một khung giờ học của ngày đó), `DAILY_LIMIT`, `OVERLAP` (tính cả thời gian nghỉ giữa phiên). Nếu Planning chưa nhận `TaskCreated` thì trả 409 `TASK_NOT_SYNCED`; client thử lại sau.

Ba chức năng kiểm tra phiên, đề xuất và mô phỏng dùng chung một bộ máy xếp chỗ (`services/planning-service/src/modules/sessions/rules.ts`). Khoảng trống được tính bằng: khung giờ học của thứ đó, trừ lịch bận, trừ phần giờ đã qua của hôm nay, trừ các phiên đã có (cộng thêm thời gian nghỉ hai bên); sau đó giới hạn theo số phút tối đa mỗi ngày.

- **Đề xuất:** việc có deadline sớm hơn được xếp trước (ưu tiên cao khi trùng hạn). Mỗi phiên dài bằng "phiên tập trung" trong Cài đặt, phiên ngắn nhất 15 phút. Lượt 1 cho mỗi việc tối đa 2 phiên/ngày để rải đều; lượt 2 lấp phần còn thiếu. Không xếp quá lịch rảnh: phần không vừa trước deadline được trả về trong `shortfalls`.
- **Mô phỏng:** các phiên chưa học trùng khoảng bận được chuyển nguyên phiên tới chỗ trống sớm nhất, từ ngày bận đến deadline (tối đa 60 ngày).

## Notification — `/api/notification`

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/notifications?limit` | `{items: [{id, kind: deadline\|plan, taskId, title, body, createdAt, read}], unreadCount}` |
| PATCH | `/notifications/:id/read` | |
| POST | `/notifications/read-all` | |

Lời nhắc sinh từ projection: việc quá hạn, đến hạn hôm nay hoặc ngày mai, và số phiên học hôm nay. Mỗi lời nhắc có unique key `(user_id, dedupe_key)` nên không lưu trùng. Lời nhắc chưa đọc tự bị gỡ khi không còn đúng (việc xong, bị xóa, dời deadline). Scheduler chạy mỗi phút để xử lý lúc sang ngày. Chỉ là thông báo trong app, không gửi email/push.

## Analytics — `/api/analytics`

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/analytics/summary?period=week\|month&date?` | `{labels, values, current, totalMinutes, streak, completedTasks, totalTasks, bySubject: [{subjectId, minutes}]}` |

Chỉ tính số phút thực tế từ `StudySessionCompleted`; không đọc database của service khác.

## Sự kiện

Exchange topic bền vững `studybalance.events`, routing key = `eventType`. Envelope và payload: [`packages/event-contracts`](../../packages/event-contracts/src/index.ts). Payload là snapshot đầy đủ; consumer bỏ qua sự kiện có `aggregateVersion` không mới hơn bản đã lưu.

| Sự kiện | Nguồn | Consumer |
|---|---|---|
| `PreferencesUpdated` | user | planning, notification, analytics |
| `AvailabilityUpdated` (khung giờ tuần + lịch bận) | user | planning |
| `TaskCreated` / `TaskUpdated` / `TaskProgressUpdated` | task | planning, notification, analytics |
| `TaskDeleted` (tombstone, version + 1) | task | planning (hủy phiên chưa học), notification, analytics |
| `StudySessionUpdated` (có cờ `deleted`) | planning | notification |
| `StudySessionCompleted` | planning | analytics |
| `PlanUpdated` | planning | (chưa có consumer) |

Độ tin cậy:

- **Outbox:** thay đổi dữ liệu và dòng `outbox` ghi trong cùng một giao dịch. Relay phát với persistent message + publisher confirm, chỉ đánh dấu đã phát sau khi broker xác nhận (`FOR UPDATE SKIP LOCKED` cho nhiều replica).
- **Inbox:** consumer ghi `processed_events(event_id)` cùng tác động dữ liệu trong một giao dịch, ACK sau commit. Sự kiện trùng bị bỏ qua.
- **Retry/DLQ:** mỗi consumer có queue `<service>.events`. Lỗi thì chuyển sang `<service>.events.retry` (TTL 5 giây, quay lại queue chính); sau 5 lần thì vào `<service>.events.dlq`. Message hỏng vào DLQ ngay.
- **Mất kết nối broker:** service tự kết nối lại và khai báo lại topology; ghi dữ liệu vẫn thành công, outbox phát bù khi broker trở lại.

Bảo đảm: giao ít nhất một lần + xử lý idempotent, không hứa exactly-once toàn cục.
