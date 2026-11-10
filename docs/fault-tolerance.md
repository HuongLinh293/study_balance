# Chịu lỗi và giám sát

Tài liệu này tổng hợp cách StudyBalance tiếp tục hoạt động khi một phần hệ thống gặp sự cố, và cách phát hiện sự cố đó. Phần dữ liệu (sao lưu, replica MySQL) xem [backup.md](backup.md).

```text
                      ┌───────────── Nginx gateway (round-robin + retry sang bản sao khác) ─────────────┐
                      ▼                    ▼            ▼                 ▼                 ▼
               user-service       task-service ×2  planning-service ×2  notification   analytics
                 │  circuit breaker ──▶ task / planning / Google Calendar
                 ▼
      /metrics trên mọi bản sao ──▶ Prometheus (DNS discovery, 8 luật cảnh báo) ──▶ Grafana dashboard
```

## Cơ chế

| Sự cố | Cơ chế | Ở đâu |
|---|---|---|
| Tiến trình chết | `restart: unless-stopped` cho mọi container chạy lâu dài. Docker khởi động lại; service chỉ nhận traffic khi `/ready` xác nhận DB và broker | `docker-compose.yml` |
| Một bản sao hỏng | task-service và planning-service chạy 2 bản sao. Nginx phân giải tên service ra nhiều IP và chia đều request. Bản sao từ chối kết nối, timeout hoặc trả 502/503 thì request chuyển sang bản kia (`proxy_next_upstream`); Nginx không tự gửi lại POST/PATCH | [nginx default.conf](../infrastructure/nginx/default.conf) |
| Service phụ thuộc chậm hoặc chết | **Circuit breaker**: 5 lỗi liên tiếp → mở mạch, các lần gọi sau thất bại ngay không chờ timeout; sau 30 giây (Google: 60 giây) cho 1 lần gọi thử; thành công thì đóng mạch. Chỉ lỗi mạng, timeout, 5xx, 429 mới tính; 4xx là lỗi của request, không phải của service | [circuitBreaker.ts](../packages/service-kit/src/circuitBreaker.ts), dùng ở user-service khi gọi planning, task và Google Calendar |
| RabbitMQ ngắt | Outbox giữ sự kiện trong DB, relay phát bù khi broker trở lại; service tự kết nối lại | [broker.ts](../packages/service-kit/src/broker.ts) |
| Sự kiện xử lý lỗi | Retry qua hàng đợi TTL 5 giây, tối đa 5 lần rồi vào DLQ. Inbox bỏ qua sự kiện trùng | như trên |
| Hai bản sao cùng xử lý | Hai bản sao là consumer cạnh tranh trên cùng queue. Sự kiện có thể đến lệch thứ tự; projection chỉ ghi khi `aggregateVersion` mới hơn (`SELECT … FOR UPDATE`). Outbox relay dùng `SKIP LOCKED` nên hai bản sao không phát trùng một lô | |

## Giám sát

Mỗi service mở `GET /metrics` (định dạng Prometheus, gateway chặn từ ngoài). Mỗi response có header `X-Served-By` cho biết bản sao nào đã trả lời.

| Metric | Ý nghĩa |
|---|---|
| `studybalance_http_request_duration_seconds` | Histogram theo `method`, `route` (template như `/tasks/:id`), `status` |
| `studybalance_events_consumed_total` | Sự kiện nhận theo `outcome`: processed, duplicate, retry, dead_lettered, malformed, ignored |
| `studybalance_events_published_total` | Sự kiện outbox đã được RabbitMQ xác nhận |
| `studybalance_outbox_pending` | Sự kiện chưa phát (đọc từ DB khi scrape) |
| `studybalance_broker_connected` | 1 khi channel RabbitMQ đang mở |
| `studybalance_circuit_state`, `…_circuit_rejections_total` | 0 đóng, 1 nửa mở, 2 mở; số lần bị từ chối nhanh |
| Mặc định của `prom-client` | CPU, bộ nhớ, event loop lag, GC của Node.js |

Prometheus tìm bản sao qua DNS của Docker (`dns_sd_configs`), nên khi thêm bản sao không cần sửa cấu hình. RabbitMQ được scrape qua plugin Prometheus có sẵn (`:15692/metrics/per-object`).

**Cảnh báo** ([alerts.yml](../infrastructure/prometheus/alerts.yml), xem ở Prometheus → Alerts):

- `ServiceDown`: một service không còn bản sao nào khỏe.
- `ReplicasBelowDesired`: task hoặc planning chạy ít hơn 2 bản sao.
- `ServiceInstanceDown`: bản sao còn phân giải được nhưng không trả lời.
- `BrokerDisconnected`, `OutboxBacklog`, `CircuitOpen`, `EventsDeadLettered`, `HighServerErrorRate`.

Bản sao bị dừng biến khỏi DNS, nên Prometheus thấy target biến mất thay vì `up == 0`. Vì vậy cần hai cảnh báo theo số bản sao (`ServiceDown`, `ReplicasBelowDesired`) chứ không chỉ dựa vào `up`.

| Địa chỉ | |
|---|---|
| http://localhost:3030 | Grafana, dashboard "StudyBalance — Tổng quan hệ thống" là trang chủ. Tài khoản `admin` / `GRAFANA_ADMIN_PASSWORD` |
| http://localhost:9090 | Prometheus: Targets, Alerts, truy vấn |

Log: mọi service ghi JSON một dòng có `service`, `event`, `correlationId`. Theo dõi một request qua các service: `docker compose logs -f | grep <correlationId>`.

## Thử lại

```sh
docker stop studybalance-task-service-1          # một bản sao chết: request vẫn 200, ReplicasBelowDesired bắn sau ~30s
docker exec studybalance-planning-service-2 kill -TERM 1   # tiến trình tự thoát: Docker khởi động lại
npm run test:outage                               # RabbitMQ ngắt: outbox tăng rồi về 0, broker_connected 0 → 1
```

`docker kill` / `docker stop` được Docker coi là dừng chủ động, nên `unless-stopped` không khởi động lại. Để mô phỏng crash, cho tiến trình bên trong tự thoát như lệnh thứ hai.

## Giới hạn

- Chưa có Alertmanager: cảnh báo chỉ hiện trong Prometheus, không gửi email hay chat.
- Log chưa được gom về một nơi (ELK, Loki); đang đọc qua `docker compose logs`.
- Số bản sao cố định trong Compose; chưa có auto-scaling (cần Kubernetes HPA hoặc tương đương).
- user-service, notification-service, analytics-service, gateway, MySQL primary và RabbitMQ vẫn chạy một bản. user-service chưa nhân bản được vì giới hạn đăng nhập sai đang lưu trong bộ nhớ.
