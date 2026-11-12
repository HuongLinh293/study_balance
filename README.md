# StudyBalance

Trợ lý lập kế hoạch học tập cá nhân cho sinh viên. Đặc tả: [Chi tiết đề tài](StudyBalance_Chi_tiet_de_tai.md).

## Trạng thái

- **Backend:** năm service Express/TypeScript với MySQL (`mysql2`, migration SQL chạy khi khởi động) và RabbitMQ. Có xác thực JWT + refresh token xoay vòng, outbox/inbox, retry/DLQ và tự kết nối lại broker. Xem [tài liệu API và sự kiện](docs/api/README.md).
- **Frontend:** đăng nhập/đăng ký, toàn bộ dữ liệu đọc ghi qua API (TanStack Query). Mô phỏng, thống kê và thông báo lấy từ service; không còn localStorage. Thông báo cập nhật thời gian thực qua Server-Sent Events (`/api/notification/notifications/stream`).
- Lịch rảnh theo tuần và lịch bận/ngày nghỉ tùy chỉnh. Có đề xuất kế hoạch tự động kèm báo thiếu thời gian, và mô phỏng khoảng bận tùy chọn rải phiên sang nhiều ngày.
- Chưa làm: quên mật khẩu qua email, gửi email/push, OpenAPI/Swagger, rate limit dùng chung khi user-service chạy nhiều replica.

## Google Calendar

Có tích hợp OAuth để lấy giờ bận từ Google và xuất phiên học vào lịch Google riêng StudyBalance, đồng bộ nền khoảng 5 phút cho 60 ngày sắp tới. Chỉnh sửa phiên học trong StudyBalance; chưa nhập ngược thay đổi sự kiện trên Google. Cần cấu hình Google Cloud OAuth Client trước khi kết nối tài khoản thật. Xem [hướng dẫn cấu hình và phạm vi đồng bộ](docs/google-calendar.md).

## Yêu cầu

- Node.js 24 (xem `.nvmrc`), npm 11.
- Docker với Docker Compose nếu chạy hạ tầng hoặc toàn bộ hệ thống.

## Chạy phát triển

```sh
npm ci
cp .env.example .env
npm run infra:up          # MySQL + RabbitMQ
for s in user task planning notification analytics; do
  cp services/$s-service/.env.example services/$s-service/.env
done
npm run dev
```

Lần đầu `infra:up` chạy file init MySQL, tạo năm database và năm tài khoản riêng. Mỗi service tự chạy migration khi khởi động. `npm run dev` build `packages/*` trước, rồi chạy frontend và năm service ở chế độ watch.

Frontend: http://localhost:5173. Vite chuyển tiếp `/api/user`, `/api/task`, `/api/planning`, `/api/notification`, `/api/analytics` tới các cổng 3001–3005. Ví dụ: http://localhost:5173/api/user/health.

`JWT_SECRET` phải giống nhau ở mọi service. Root `.env` dùng cho Compose, không tự truyền vào các tiến trình chạy bằng npm. Nếu đổi cổng service, cập nhật proxy Vite tương ứng.

## Chạy toàn bộ bằng Docker

```sh
cp .env.example .env
docker compose up --build -d
```

Mở https://localhost:8443, kiểm tra https://localhost:8443/api/user/health. Cổng HTTP (`GATEWAY_PORT`, mặc định 8080) chỉ chuyển hướng sang HTTPS (`GATEWAY_HTTPS_PORT`, mặc định 8443); đổi trong `.env` nếu cổng đã bị dùng.

**TLS:** lần đầu `docker compose up`, container `gateway-cert` tạo chứng chỉ tự ký cho `localhost`, `127.0.0.1`, `::1` trong `infrastructure/nginx/certs/` (không commit). Gateway chỉ nhận TLS 1.2/1.3, bật HTTP/2; cookie refresh có `Secure`. Trình duyệt sẽ cảnh báo chứng chỉ chưa tin cậy. Để bỏ cảnh báo: tin cậy file `tls.crt` (macOS: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain infrastructure/nginx/certs/tls.crt`), hoặc tạo chứng chỉ bằng `mkcert localhost 127.0.0.1 ::1`, đổi tên thành `tls.crt`/`tls.key` trong thư mục trên rồi `docker compose restart gateway`. Compose chỉ đánh dấu service healthy khi `/ready` xác nhận được DB và broker. RabbitMQ Management: http://localhost:15672, tài khoản theo `.env`.

```sh
docker compose logs -f
docker compose down
```

Container `backup` sao lưu cả năm database mỗi ngày vào `backups/` (giữ 7 lượt). Sao lưu ngay: `npm run backup:now`; khôi phục: `npm run backup:restore`. task-service và planning-service chạy 2 bản sao sau Nginx; mọi container tự khởi động lại khi lỗi. Prometheus (http://localhost:9090) thu metrics và cảnh báo, Grafana (http://localhost:3030) có dashboard tổng quan. Xem [chịu lỗi và giám sát](docs/fault-tolerance.md).

`mysql-replica` là bản sao chỉ đọc của MySQL, đồng bộ liên tục qua GTID replication (`npm run replica:status`). Xem [sao lưu, khôi phục và replica](docs/backup.md).

Dữ liệu giữ trong named volumes. MySQL init tạo năm database và năm tài khoản riêng khi volume trống; thay file init không cập nhật database đã tồn tại. Mật khẩu mẫu chỉ dành cho phát triển. Các cổng hạ tầng chỉ bind loopback cho dev; khi triển khai cần bỏ mapping và quản lý secrets riêng.

## Cấu trúc

```text
frontend/src/            app, components/ui, features, hooks, lib, styles, types
services/
  user-service/          tài khoản, lịch cá nhân, thiết lập
  task-service/          môn học, công việc, tiến độ
  planning-service/      kế hoạch, mô phỏng, phiên học
  notification-service/  nhắc việc và thông báo
  analytics-service/     thống kê từ sự kiện
packages/event-contracts/  envelope và payload sự kiện
packages/service-kit/      tiện ích hạ tầng dùng chung
infrastructure/         nginx, mysql, rabbitmq, backup
docs/                   architecture, api, test-results
```

Mỗi service có `src/app.ts`, `src/index.ts`, `src/migrations.ts`, `src/modules/`, `tests/`, `.env.example` và Dockerfile riêng, cùng database riêng. Không service nào đọc database của service khác. `packages/service-kit` chỉ chứa tiện ích hạ tầng dùng chung (HTTP, JWT, MySQL/migration, outbox/inbox, broker), không chứa model nghiệp vụ.

## Kiểm tra

```sh
npm run typecheck
npm run build
npm test                  # unit test: frontend + quy tắc lập lịch, lời nhắc, thống kê, mật khẩu
docker compose config --quiet
```

Khi stack Compose đang chạy:

```sh
npm run test:e2e          # luồng xuyên service qua gateway
npm run test:outage       # tắt/bật RabbitMQ trong lúc ghi dữ liệu
```

Đặt `E2E_BASE_URL` nếu gateway không ở https://localhost:8443; hai lệnh test tự tin cậy chứng chỉ local qua `NODE_EXTRA_CA_CERTS`. `test:e2e` dùng RabbitMQ Management (cổng 15672) để gửi một sự kiện hai lần, kiểm tra inbox chỉ xử lý một lần. `test:outage` gọi `docker compose stop/start rabbitmq`.

Chạy riêng: `npm run dev -w @studybalance/user-service` hoặc `npm run dev -w @studybalance/frontend` (cần build `packages/*` trước: `npm run build:packages`).

## Tài liệu công nghệ

- [Vite: khởi động và yêu cầu Node.js](https://vite.dev/guide/)
- [RabbitMQ: publisher confirms và dead lettering](https://www.rabbitmq.com/docs/confirms)

Bước tiếp theo: OpenAPI/Swagger, theo dõi queue/DLQ, đưa kịch bản kiểm thử giao diện vào repo.
