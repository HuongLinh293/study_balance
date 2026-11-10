# Nội dung Slide Báo cáo: Kiến trúc Hạ tầng & Luồng Nghiệp vụ từng Microservice — StudyBalance

> **Đề tài:** Trợ lý lập kế hoạch học tập cá nhân cho sinh viên theo kiến trúc Microservices hướng sự kiện (Event-Driven Architecture).  
> **Sinh viên thực hiện:** Linh  

---

## Slide 1 — Đặt vấn đề & Mục tiêu Đề tài

### 1. Thực trạng & Nhu cầu thực tế của sinh viên (Pain Points)
- **Quản lý đa nhiệm và quá tải**: Sinh viên phải đồng thời xử lý nhiều môn học, bài tập lớn, báo cáo thí nghiệm và ôn thi.
- **Hạn chế của danh sách công việc (To-Do List / Deadline tĩnh)**:
  - Chỉ cho biết *khi nào phải nộp*, nhưng **chưa trả lời được**: *Hôm nay nên học gì? Bắt đầu khi nào? Làm trong bao lâu?*
  - Không đối chiếu giữa **khối lượng bài tập cần làm** với **quỹ thời gian rảnh thực tế** ➔ Thường dẫn tới nước đến chân mới nhảy hoặc kiệt sức (Burnout).
- **Vỡ kế hoạch khi có việc phát sinh**: Khi có lịch bận đột xuất hoặc làm bài chậm tiến độ, sinh viên không biết phải dời lịch như thế nào cho hợp lý, dẫn đến tâm lý chán nản và bỏ theo dõi lịch.

### 2. Ý tưởng & Giải pháp: StudyBalance — "Kế hoạch thay đổi cùng bạn"
- **Chuyển Deadline thành Phiên học cụ thể**: Phân bổ bài tập vào đúng các khung giờ rảnh (sau khi đã trừ lịch học trường, lịch bận cá nhân và lịch bận Google Calendar).
- **Cảnh báo thiếu hụt trung thực (Shortfall)**: Nếu quỹ thời gian không đủ trước hạn nộp, hệ thống chỉ rõ chính xác phần thời gian bị thiếu (ví dụ: *Thiếu 2 giờ trước deadline Mạng máy tính*) thay vì tự ý xếp tràn giờ ảo.
- **Mô phỏng "Nếu... thì sao?" (What-If Simulation)**: Cho phép thử kịch bản (ví dụ: *"Nếu chiều nay nghỉ học thì sao?"*), xem trước tác động và chỉ áp dụng khi người dùng xác nhận.

### 3. Mục tiêu học thuật & Đóng góp kỹ thuật
- Vận dụng kiến trúc **Microservices hướng sự kiện (Event-Driven Architecture)** giải quyết bài toán nghiệp vụ phức tạp của sinh viên.
- Xây dựng 5 microservices độc lập giao tiếp qua **RabbitMQ**, áp dụng mẫu **Database-per-service**, **Transactional Outbox** và **Idempotent Consumer** để đảm bảo tính nhất quán dữ liệu và khả năng chịu lỗi trong môi trường phân tán.

---

## Slide 2 — Tổng quan Kiến trúc Hạ tầng & Đóng gói Triển khai

### 1. Mô hình tổng thể (Topology)
- **Client Tier**: Web Single-Page Application (React 19 + TypeScript + Vite + Tailwind CSS 4), chạy trong trình duyệt.
- **Gateway Tier**: Nginx API Gateway (cổng 8088) làm Reverse Proxy: định tuyến `/api/<service>/*` tới đúng service, phát file tĩnh của frontend ở `/`, chặn các endpoint nội bộ `/ready`. Frontend và API chung một origin nên không cần cấu hình CORS.
- **Service Tier**: 5 Microservices độc lập viết bằng Node.js / Express / TypeScript:
  1. `user-service` (Port nội bộ 3001)
  2. `task-service` (Port nội bộ 3002)
  3. `planning-service` (Port nội bộ 3003)
  4. `notification-service` (Port nội bộ 3004)
  5. `analytics-service` (Port nội bộ 3005)
- **Message Broker Tier**: RabbitMQ 4 (AMQP 5672) phục vụ giao tiếp hướng sự kiện bất đồng bộ.
- **Data Tier**: MySQL 8.4 với mô hình **Database-per-service** (5 schemas tách biệt hoàn toàn).
- **Containerization**: Toàn bộ hệ thống được container hóa và điều phối qua **Docker Compose** với healthcheck tự động.

### 2. Sơ đồ kiến trúc hạ tầng
```text
① CLIENT
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Trình duyệt chạy Frontend SPA                        │
│                         React 19 + TypeScript + Vite                        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP :8088  (gọi /api/...)
② GATEWAY                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Nginx API Gateway (Reverse Proxy :8088)                   │
│        định tuyến /api/<service>/* · "/" phát file tĩnh của frontend        │
└──────┬───────────────┬───────────────┬───────────────┬───────────────┬──────┘
       │ ③ NGHIỆP VỤ   │               │               │               │
       ▼               ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ user        │ │ task        │ │ planning    │ │ notification│ │ analytics   │
│ :3001       │ │ :3002       │ │ :3003       │ │ :3004       │ │ :3005       │
└──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
       └───────────────┴───────────────┼───────────────┴───────────────┘
                  ┌────────────────────┴────────────────────┐
                  │ publish / consume                       │ đọc / ghi (SQL)
④ DỮ LIỆU         ▼                                         ▼
┌───────────────────────────────────┐     ┌───────────────────────────────────┐
│      RabbitMQ 4 (AMQP :5672)      │     │         MySQL 8.4 (:3306)         │
│    exchange studybalance.events   │     │        Database-per-service       │
│       (topic) + retry / DLQ       │     │   5 schema, mỗi service 1 schema  │
└───────────────────────────────────┘     └───────────────────────────────────┘
```

> Frontend là tầng client: code React chạy trong trình duyệt và gọi xuống backend qua gateway. Container `frontend` chỉ là nginx phát file tĩnh (HTML/JS/CSS) khi gateway nhận đường `/`; nó không gọi trực tiếp tới service nào.

---

## Slide 3 — Ngăn xếp Công nghệ đã sử dụng (Technology Stack)

### 1. Bảng phân loại công nghệ theo từng tầng

| Phân tầng | Công nghệ chính | Phiên bản / Thư viện tiêu biểu | Vai trò & Lý do lựa chọn |
|---|---|---|---|
| **Frontend** | React, TypeScript, Vite | React 19, TypeScript 5, Vite 7, TanStack Query v5 | Xây dựng Single-Page Application; React 19 tối ưu render; TanStack Query quản lý cache và đồng bộ dữ liệu client mượt mà; TypeScript đảm bảo an toàn kiểu dữ liệu. |
| **Giao diện & UI** | Tailwind CSS, Phosphor Icons | Tailwind CSS 4 (@tailwindcss/vite), @phosphor-icons/react, font Be Vietnam Pro | Dựng giao diện responsive nhanh bằng utility class; bộ icon đồng bộ; font hỗ trợ tốt tiếng Việt. |
| **API Gateway** | Nginx | nginx:stable-alpine | Reverse Proxy cổng 8088; định tuyến `/api/<service>` và che giấu cổng nội bộ của service; frontend và API chung origin nên không cần CORS; không ghi log URL callback OAuth. |
| **Backend Services** | Node.js, Express, TypeScript | Node.js 24 Alpine, Express 5, Zod v4 | 5 microservice độc lập; mô hình bất đồng bộ non-blocking I/O xử lý tải tốt; Zod validate dữ liệu đầu vào chặt chẽ. |
| **Bảo mật & Xác thực** | JWT, scrypt, Google OAuth 2.0 | jose, node:crypto (scrypt), google-auth-library | Đăng nhập an toàn; Access Token in-memory + Refresh Token xoay vòng trong cookie HttpOnly (dùng lại token cũ → thu hồi cả chuỗi); đăng nhập bằng tài khoản Google. |
| **Message Broker** | RabbitMQ | RabbitMQ 4 Management Alpine, amqplib | Hàng đợi sự kiện chuẩn AMQP 0-9-1; Topic Exchange (`studybalance.events`); Dead-letter exchange (`studybalance.dlx`); chịu lỗi với cơ chế retry. |
| **Cơ sở dữ liệu** | MySQL | MySQL 8.4 Server, mysql2/promise | Cơ sở dữ liệu quan hệ mạnh mẽ, đảm bảo tính toàn vẹn ACID; mô hình Database-per-service (5 schema riêng). |
| **Đóng gói & Vận hành** | Docker, Docker Compose | Docker Compose v2 | Đóng gói toàn bộ 9 container (Frontend, Gateway, 5 Services, RabbitMQ, MySQL) trong 1 mạng bridge; healthcheck quyết định thứ tự khởi động; chạy bằng 1 lệnh `docker compose up`. |
| **Thư viện dùng chung (Monorepo)** | npm workspaces | `@studybalance/service-kit`, `@studybalance/event-contracts` | Tái sử dụng logic Outbox/Inbox relay, kết nối database/broker, chuẩn hóa cấu trúc sự kiện xuyên suốt các service. |

---

## Slide 4 — Kiến trúc Dữ liệu & Đảm bảo Tính nhất quán Phân tán

### 1. Mô hình Database-per-service
Mỗi microservice sở hữu một schema và một tài khoản MySQL riêng, không service nào đọc schema của service khác:
- `user_db`: `users`, `refresh_tokens`, `preferences`, `availability` (khung giờ rảnh tuần), `busy_periods` (khoảng bận tự khai), `google_connections`, `google_busy` (lịch bận đọc từ Google), `google_exports` (phiên học đã ghi lên Google).
- `task_db`: `subjects`, `tasks`, `subtasks` (các bước nhỏ), `progress_updates` (lịch sử trừ phút theo phiên học).
- `planning_db`: `study_sessions`, `plan_proposals` (kế hoạch xem trước), `simulations`, cùng các bản chiếu `task_projection`, `preferences_projection`, `availability_projection`.
- `notification_db`: `notifications`, cùng các bản chiếu `task_projection`, `session_projection`, `preferences_projection`.
- `analytics_db`: `task_facts`, `session_facts`, `preferences_projection`.

### 2. Giải pháp kỹ thuật cho hệ thống phân tán
- **Transactional Outbox**: sự kiện được ghi vào bảng `outbox` trong cùng transaction với dữ liệu nghiệp vụ, sau đó relay đọc bảng này và publish lên RabbitMQ ➔ không mất sự kiện khi broker tạm dừng (at-least-once).
- **Idempotent Consumer**: bảng `processed_events` ghi lại `eventId` đã xử lý; ngoài ra consumer bỏ qua sự kiện có `aggregateVersion` không mới hơn bản đang lưu ➔ nhận lặp hay nhận sai thứ tự đều không làm hỏng dữ liệu.
- **Optimistic Concurrency**: `tasks` và `study_sessions` có cột `version`; request sửa gửi kèm version cũ sẽ bị từ chối `409 VERSION_CONFLICT`.
- **Xem trước rồi mới áp dụng**: kế hoạch và mô phỏng lưu kèm "dấu vân tay" dữ liệu; nếu dữ liệu đã đổi hoặc bản xem trước quá 30 phút thì bị từ chối `409 PLAN_STALE` / `SIMULATION_STALE` thay vì ghi đè.

---

## Slide 5 — Service 1: `user-service` (Tài khoản, Lịch rảnh & Tích hợp Google)

### 1. Trách nhiệm chính
- Đăng ký, đăng nhập bằng email + mật khẩu (băm scrypt) hoặc tài khoản Google; cấp JWT access token và refresh token trong cookie HttpOnly.
- Hồ sơ và cài đặt học tập (`preferences`): độ dài phiên, thời gian nghỉ, giới hạn phút/ngày, bật/tắt nhắc nhở, múi giờ.
- Quỹ thời gian: khung giờ rảnh trong tuần (`availability`) và các khoảng bận cụ thể (`busy_periods`).
- Kết nối Google Calendar: ghi phiên học lên một lịch riêng tên "StudyBalance" và đọc lịch bận của người dùng về.

### 2. Luồng hoạt động nghiệp vụ
```text
① Đăng nhập
POST /auth/login
 ├─ so mật khẩu với hash scrypt          ✕ 429 sau 10 lần sai trong 15 phút
 ├─ ký access token (JWT) + tạo refresh token
 └─ trả access token, refresh token nằm trong cookie HttpOnly
POST /auth/refresh: mỗi refresh token chỉ dùng được 1 lần;
                    dùng lại token cũ → thu hồi cả chuỗi token

② Đăng nhập Google
POST /auth/google  (hoặc GET /auth/google/start → /auth/google/callback)
 ├─ xác thực ID token với Google
 ├─ tìm user theo google_id hoặc email, chưa có thì tạo mới
 └─ cấp token như đăng nhập thường

③ Cài đặt và lịch rảnh
PATCH /me                        ─► preferences  ─► outbox ─► PreferencesUpdated
PUT /me/availability             ─► availability ┐
POST | DELETE /me/busy-periods   ─► busy_periods ┴► outbox ─► AvailabilityUpdated
                       (snapshot đầy đủ: khung giờ + bận tự khai + bận Google)

④ Đồng bộ Google Calendar
POST /integrations/google/sync
 ├─ HTTP nội bộ: lấy phiên học (planning) + tên task (task)    ✕ 503 nếu lỗi
 ├─ tạo/sửa sự kiện trên lịch "StudyBalance" của Google   → google_exports
 ├─ đọc lịch bận (events + freeBusy), thay toàn bộ        → google_busy
 ├─ outbox ─► AvailabilityUpdated
 └─ trả số phiên học đang trùng lịch bận
```

---

## Slide 6 — Service 2: `task-service` (Môn học & Công việc)

### 1. Trách nhiệm chính
- Nguồn dữ liệu gốc của môn học (`subjects`) và công việc (`tasks`): tiêu đề, hạn nộp, độ ưu tiên (`high` / `normal`), số phút còn phải học (`remaining_minutes`), các bước nhỏ (`subtasks`).
- Là service duy nhất được trừ số phút còn lại, dựa trên tiến độ thực tế sau mỗi phiên học.
- Mọi thay đổi task đều phát sự kiện kèm snapshot đầy đủ để các service khác tự cập nhật bản chiếu.

### 2. Luồng hoạt động nghiệp vụ
Mọi thao tác ghi bên dưới chạy trong 1 transaction gồm cả dữ liệu lẫn bản ghi outbox.
```text
① Tạo task
POST /tasks  (id do client sinh)
 ├─ kiểm tra dữ liệu (Zod) + môn học tồn tại            ✕ 400
 ├─ INSERT tasks + subtasks; id đã tồn tại → trả lại task cũ (gửi lại an toàn)
 └─ outbox ─► TaskCreated

② Sửa task
PATCH /tasks/:id  {version, ...}
 ├─ version khác bản trong DB                            ✕ 409 VERSION_CONFLICT
 ├─ UPDATE, version + 1
 └─ outbox ─► TaskUpdated

③ Ghi tiến độ  (frontend gọi sau khi kết thúc phiên học)
PATCH /tasks/:id/progress  {minutes, sessionId}
 ├─ INSERT progress_updates; sessionId đã ghi rồi → bỏ qua, không trừ 2 lần
 ├─ remaining_minutes = max(0, remaining_minutes − minutes)
 └─ outbox ─► TaskProgressUpdated

④ Xoá
DELETE /tasks/:id     ─► xoá task ─► TaskDeleted (tombstone, version + 1)
DELETE /subjects/:id  ─► gỡ môn khỏi các task ─► TaskUpdated cho từng task
```

---

## Slide 7 — Service 3: `planning-service` (Lập lịch, Mô phỏng & Phiên học)

### 1. Trách nhiệm chính
- Biến khối lượng công việc (từ `task-service`) và quỹ thời gian (từ `user-service`) thành các phiên học cụ thể (`study_sessions`).
- Không gọi HTTP sang service khác: dữ liệu cần thiết đến bằng sự kiện và được lưu thành bản chiếu trong `planning_db`.
- Ba tính năng chính: **lập kế hoạch tự động**, **mô phỏng "nếu hôm nay bận"**, **xếp / sửa phiên học bằng tay**. Cả ba dùng chung một bộ quy tắc "thời gian trống" = khung giờ rảnh − khoảng bận − phần đã trôi qua của hôm nay − các phiên đã có (cộng thời gian nghỉ).

### 2. Luồng hoạt động nghiệp vụ
```text
① Cập nhật bản chiếu (nghe sự kiện)
Task* | PreferencesUpdated | AvailabilityUpdated
 ├─ bỏ qua nếu version không mới hơn bản đang lưu
 └─ upsert task_projection / preferences_projection / availability_projection
TaskDeleted ─► huỷ các phiên chưa học của task ─► StudySessionUpdated (deleted)

② Lập kế hoạch tự động: xem trước rồi mới áp dụng
POST /plans/generate
 ├─ task client gửi lên chưa đến qua sự kiện        ✕ 409 TASK_NOT_SYNCED
 ├─ xếp hạn gần trước, ưu tiên cao trước;
 │  lượt 1 tối đa 2 phiên/task/ngày để rải đều, lượt 2 lấp phần còn thiếu
 ├─ không đủ chỗ trước hạn → báo shortfall kèm số phút thiếu (không nhồi)
 └─ lưu plan_proposals (preview + dấu vân tay dữ liệu) ─► trả về để xem
POST /plans/:id/apply
 ├─ dữ liệu đã đổi hoặc preview quá 30 phút         ✕ 409 PLAN_STALE
 ├─ INSERT study_sessions
 └─ outbox ─► StudySessionUpdated × n + PlanUpdated

③ Mô phỏng "nếu bận"
POST /simulations  {scenario: afternoon | whole}  hoặc  {date, startMinute, endMinute}
 ├─ phiên trùng giờ bận → dời nguyên phiên tới chỗ trống sớm nhất trước hạn
 └─ lưu simulations (preview: moved / unscheduled)
POST /simulations/:id/apply  {dropUnscheduled}
 ├─ dữ liệu đã đổi hoặc quá 30 phút                 ✕ 409 SIMULATION_STALE
 ├─ còn phiên không xếp được và dropUnscheduled = false
 │                                                  ✕ 422 SIMULATION_INFEASIBLE
 ├─ UPDATE phiên được dời, DELETE phiên bị bỏ
 └─ outbox ─► StudySessionUpdated + PlanUpdated

④ Xếp / sửa / xoá phiên bằng tay
POST | PATCH | DELETE /study-sessions
 ├─ khoá theo user: các request của cùng một người chạy lần lượt
 ├─ trùng giờ, vượt giới hạn ngày, ngoài giờ rảnh    ✕ 422
 ├─ version cũ ✕ 409 VERSION_CONFLICT · phiên đã học ✕ 409 SESSION_DONE
 └─ outbox ─► StudySessionUpdated

⑤ Kết thúc phiên học
POST /study-sessions/:id/finish  {actualMinutes}
 ├─ status = done, lưu số phút học thực tế
 └─ outbox ─► StudySessionUpdated + StudySessionCompleted
```

---

## Slide 8 — Service 4: `notification-service` (Thông báo trong ứng dụng)

### 1. Trách nhiệm chính
- Tạo thông báo nhắc hạn nộp và nhắc kế hoạch học trong ngày, hiển thị ở chuông thông báo.
- Chỉ nghe sự kiện, không phát sự kiện nào. Hai đường vào đều dẫn tới cùng một hàm tính lại nhắc nhở cho một người dùng.

### 2. Luồng hoạt động nghiệp vụ
```text
① Hai đường vào
Task* | StudySessionUpdated | PreferencesUpdated
 └─ upsert task_projection / session_projection / preferences_projection
    ─► tính lại nhắc nhở của user đó
Hẹn giờ mỗi 60 giây
 └─ lấy các user có task chưa xong hoặc phiên chưa học
    ─► tính lại nhắc nhở (bắt kịp khi sang ngày mới mà không có sự kiện nào)

② Tính lại nhắc nhở cho một user
 ├─ user tắt nhắc nhở → danh sách rỗng
 ├─ task chưa xong, hạn ≤ ngày mai → "… sắp đến hạn" hoặc "… đã quá hạn"
 ├─ hôm nay có phiên chưa học → "Hôm nay có N phiên học"
 ├─ xoá nhắc chưa đọc không còn đúng (task xong, bị xoá, đổi hạn)
 └─ INSERT IGNORE theo dedupe_key → một nhắc nhở không bao giờ bị tạo 2 lần

③ API cho chuông thông báo
GET   /notifications            chưa đọc lên đầu, kèm unreadCount
PATCH /notifications/:id/read   đánh dấu đã đọc
POST  /notifications/read-all   đánh dấu đọc hết
```

---

## Slide 9 — Service 5: `analytics-service` (Thống kê & Nhìn lại)

### 1. Trách nhiệm chính
- Mô hình chỉ đọc (read model, theo tinh thần CQRS) cho màn hình "Nhìn lại".
- Gom sự kiện thành fact, khi được hỏi mới tính số liệu: tổng phút học, chuỗi ngày học liên tiếp, số task hoàn thành, phút học theo môn.

### 2. Luồng hoạt động nghiệp vụ
```text
① Thu thập fact (nghe sự kiện)
Task*                  ─► task_facts (môn học, đã xong chưa; bỏ qua version cũ)
StudySessionCompleted  ─► session_facts (số phút thực tế; INSERT IGNORE theo id phiên)
PreferencesUpdated     ─► preferences_projection (múi giờ, để biết "hôm nay")

② Báo cáo
GET /analytics/summary?period=week|month&date=
 ├─ cộng phút học theo ngày → biểu đồ T2…CN, hoặc Tuần 1…5 của tháng
 ├─ chuỗi ngày học liên tiếp tính tới hôm nay (streak)
 ├─ số task đã xong / tổng số task
 └─ phút học theo từng môn
```

---

## Slide 10 — Luồng Nghiệp vụ Xuyên suốt: Thêm việc ➔ Lập lịch ➔ Học tập

Các service không gọi nhau trực tiếp: frontend gọi từng service qua gateway, còn dữ liệu lan sang service khác bằng sự kiện qua RabbitMQ.

```text
1. Thêm công việc (hạn thứ 6, cần 120 phút)
   Frontend ─► POST /tasks ─► task-service
   task-service ─► TaskCreated ─► RabbitMQ
      ├─► planning-service      cập nhật task_projection
      ├─► notification-service  nhắc ngay nếu hạn ≤ ngày mai
      └─► analytics-service     ghi task_facts

2. Lập kế hoạch
   Frontend ─► POST /plans/generate ─► planning-service
   Frontend ◄─ bản xem trước (2 phiên × 60 phút) + shortfall nếu thiếu chỗ
   Frontend ─► POST /plans/:id/apply ─► planning-service
   planning-service ─► StudySessionUpdated × 2, PlanUpdated ─► RabbitMQ
      └─► notification-service  "Hôm nay có N phiên học"

3. Học xong một phiên
   Frontend ─► POST /study-sessions/:id/finish ─► planning-service
   planning-service ─► StudySessionCompleted ─► RabbitMQ
      └─► analytics-service     cộng phút học vào biểu đồ
   Frontend ─► PATCH /tasks/:id/progress {sessionId} ─► task-service
   task-service ─► TaskProgressUpdated ─► RabbitMQ
      └─► planning, notification, analytics cập nhật số phút còn lại
```

---

## Slide 11 — Tóm tắt Điểm nổi bật về Kỹ thuật khi Báo cáo

1. **Chuẩn kiến trúc Microservices**: Chia tách nghiệp vụ mạch lạc, mỗi dịch vụ có boundary rõ ràng, không truy vấn database chéo.
2. **Đảm bảo tính nhất quán (Eventual Consistency)**: Ứng dụng Transactional Outbox + Idempotent Inbox giải quyết trọn vẹn bài toán mất tin và tin nhắn lặp trong mạng phân tán.
3. **Hiệu năng cao & Độc lập**: `planning-service` sử dụng local projection, bản chiếu lưu ngay trong `planning_db` nên thuật toán lập lịch chạy được mà không phụ thuộc vào việc service khác có đang hoạt động hay không.
4. **Trải nghiệm thực tế**: Đăng nhập bằng Google; đồng bộ Google Calendar 2 chiều (ghi phiên học lên Google, đọc lịch bận về để lập lịch tránh giờ bận).
