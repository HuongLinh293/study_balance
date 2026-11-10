# Kết quả kiểm thử chịu lỗi và giám sát — 10/11/2026

Môi trường: Docker Compose trên một máy, task-service và planning-service mỗi loại 2 bản sao, Prometheus v3.5.0, Grafana 12.1.1. Xem [cơ chế](../fault-tolerance.md).

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | `npm test`: gồm 5 test mới cho circuit breaker (mở sau N lỗi, gọi lại không chạm dependency, nửa mở chỉ 1 lần thử, 4xx không mở mạch, xuất metric) | Đạt toàn bộ; `npm run typecheck` sạch |
| 2 | `npm run test:e2e` với 2 bản sao task và planning | 15/15 bước đạt |
| 3 | 20 request `/api/task/health` qua gateway, đếm `X-Served-By` | 10 / 10 giữa hai bản sao |
| 4 | `/api/task/metrics` từ ngoài gateway | 404 |
| 5 | Prometheus tìm target qua DNS | 9 target `up`: 7 bản sao service, RabbitMQ, Prometheus |
| 6 | Dừng `task-service-1`, gửi 100 request và chạy E2E | 100/100 trả 200; E2E 15/15 |
| 7 | Tiến trình trong `planning-service-2` tự thoát | Docker khởi động lại (RestartCount 0 → 1), healthy trở lại |
| 8 | Dừng `task-service-2` | `ReplicasBelowDesired` firing; bật lại thì hết cảnh báo |
| 9 | `npm run test:outage` (tắt/bật RabbitMQ) với 2 bản sao | Đạt; `broker_connected` về 0 trong lúc tắt, `outbox_pending` về 0 sau khi phát bù, inbox bỏ qua 2 sự kiện trùng |
| 10 | Grafana nạp sẵn dashboard; chạy từng truy vấn panel trên Prometheus | 16 panel; mọi panel có dữ liệu |

Phát hiện khi kiểm thử và đã sửa:

- Cảnh báo `up == 0` ban đầu không bắn khi dừng bản sao, vì target biến khỏi DNS. Đã thêm `ServiceDown` và `ReplicasBelowDesired`.
- Cổng 3000 trên máy dev bị một ứng dụng khác dùng; Grafana chuyển sang 3030.

Chưa kiểm thử với hệ thống thật: circuit breaker khi planning hoặc task chết trong lúc đồng bộ Google Calendar, vì cần tài khoản Google đã kết nối. Logic đã có unit test.
