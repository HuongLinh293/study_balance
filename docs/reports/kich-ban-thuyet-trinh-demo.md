# Kịch bản thuyết trình và demo — StudyBalance

Thời lượng giả định: **25 phút**, gồm khoảng 9 phút trình bày, 14 phút demo và 2 phút dự phòng; hỏi đáp tính riêng. Nếu hội đồng cho thời lượng khác, giữ thứ tự và co giãn theo cột "phút". Khi bị ép thời gian, dùng [bản rút gọn](#bản-rút-gọn-8-phút).

Nguyên tắc: **mỗi tiêu chí trong bảng chấm phải được *thấy* trong demo hoặc trên sơ đồ**, không chỉ được nói. Cột "Chương" cho biết phần đó lấy điểm ở tiêu chí nào.

## 1. Chuẩn bị

### Hôm trước

- [ ] Tin cậy chứng chỉ để trình duyệt không cảnh báo khi hội đồng nhìn:
  `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain infrastructure/nginx/certs/tls.crt`
  Sau đó thoát hẳn Chrome rồi mở lại.
- [ ] `docker compose up -d --build`, sau đó `npm run demo -- seed` để tạo tài khoản demo sạch.
- [ ] Chạy trọn một lượt `npm run demo` và **quay màn hình lại**. Đây là phương án dự phòng nếu demo trực tiếp gặp sự cố.
- [ ] Commit toàn bộ mã nguồn; mang theo bộ sạc. Mọi thứ chạy local nên không cần Internet, nhưng image Docker phải được tải sẵn.

### 30 phút trước

- [ ] `npm run demo -- seed` (đặt lại dữ liệu demo), rồi `npm run demo -- check` → phải thấy **"Sẵn sàng demo."**
- [ ] Mở sẵn các tab:
  - Ứng dụng https://localhost:8443: **2 cửa sổ cạnh nhau**, cùng đăng nhập `demo@studybalance.dev` / `StudyBalance2026`.
  - Grafana http://localhost:3030: dashboard "StudyBalance — Tổng quan hệ thống", khung thời gian 15 phút.
  - Prometheus http://localhost:9090/alerts.
  - RabbitMQ http://localhost:15672 → Queues.
  - Thư mục `docs/architecture/` (ảnh sơ đồ).
- [ ] Terminal: chữ lớn (⌘+ vài lần), nền tối, đứng ở thư mục dự án. Tắt thông báo hệ thống (Focus / Do Not Disturb).

## 2. Phần trình bày (≈ 9 phút)

| # | Slide | Nội dung chính | Hình | Chương | Phút |
|---|---|---|---|---|---|
| 1 | Đặt vấn đề | Sinh viên có danh sách deadline nhưng không biết hôm nay nên học gì, có đủ thời gian không. Ví dụ: 9 giờ việc, chỉ 7 giờ rảnh | — | 1 | 1 |
| 2 | Mục tiêu | Lập lịch theo quỹ thời gian thật, báo phần thiếu, "Nếu… thì sao?", cứu kế hoạch khi bị lỡ phiên. Mục tiêu học thuật: hệ phân tán hướng sự kiện chịu được lỗi | — | 1 | 0.5 |
| 3 | Kiến trúc tổng thể | 5 service theo 5 nghiệp vụ, mỗi service một database, gateway, RabbitMQ | `01-tong-quan` | 1, 2 | 1.5 |
| 4 | Vì sao chọn kiến trúc này | So sánh Monolith / SOA / Microservice / Hướng sự kiện; bài học từ Netflix (Hystrix) và Uber (DOMA) | bảng trong `architecture/README.md` | 1, 2 | 1 |
| 5 | Triển khai | Container, 2 bản sao sau Nginx, primary + replica, backup, Prometheus/Grafana | `02-trien-khai` | 2, 7, 8 | 1 |
| 6 | Giao tiếp | REST cho lệnh của người dùng; sự kiện cho lan truyền thay đổi; outbox → RabbitMQ → inbox; SSE thời gian thực | `03`, `04`, `09` | 4, 6 | 1.5 |
| 7 | Tiến trình và luồng | Planner trong `worker_threads`: event loop bị chặn 1612 ms → 12 ms; scheduler, tác vụ nền, Docker quản lý tiến trình | số liệu | 3 | 1 |
| 8 | Định danh và bảo mật | UUID, JWT 15 phút + refresh xoay vòng, DNS của Docker, TLS 1.2/1.3 | `06-xac-thuc` | 5 | 0.5 |
| 9 | Dữ liệu và chịu lỗi | Sao lưu + replica; LB, failover, restart, circuit breaker, giám sát | `07`, `08` | 7, 8 | 1 |
| 10 | Kết quả và giới hạn | E2E 16/16, kiểm thử luồng cứu kế hoạch, các phép thử sự cố; thuật toán xếp lịch nhanh hơn ~5 lần (500 việc: 502 → 114 ms); nêu thẳng giới hạn (mục 6) | `docs/test-results/` | — | 0.5 |

Câu chuyển sang demo: *"Em xin demo theo đúng thứ tự các tiêu chí: đầu tiên là sản phẩm, sau đó lần lượt từng cơ chế phân tán."*

## 3. Demo

### Phần A — Sản phẩm trên giao diện (≈ 5 phút, chương 1–2)

Dùng cửa sổ trái. Các bước đã được bấm thử trên Chrome với tài khoản demo vừa `seed`.

1. **Hôm nay:** thẻ "Tiếp theo, tập trung vào" (Bài tập chia subnet), thời gian học hôm nay và số việc đã hoàn thành.
   Ngay trên cùng là thẻ **Cứu kế hoạch**: `seed` tạo sẵn một phiên *Ôn thi giữa kỳ CSDL* tối qua chưa học.
   > "Tối qua em bận, bỏ lỡ 50 phút ôn thi. Hệ thống không giả vờ là phiên đó vẫn còn: 50 phút này không còn giữ chỗ trong lịch nữa."

   Chỉ vào hai nút **Tôi đã học** (nếu thực ra đã học nhưng quên ghi) và **Bỏ qua**, rồi bấm **Xếp lại phần đã lỡ**: bản đề xuất xếp lại **1 phiên, 50 phút** trước deadline. Bấm **"Thêm 1 phiên vào lịch"**; thẻ biến mất.
   > "Hệ thống không tự dời deadline hay tự thêm giờ ngoài lịch rảnh. Mọi thay đổi chỉ xảy ra khi em đồng ý."
2. **Bước nhỏ:** mở *Báo cáo chuẩn hóa 3NF*, tick bước "Vẽ ERD", tiêu đề đổi thành "1/3 xong".
3. **Lịch của tôi → Lịch tuần:** lịch tự mở ở 18:30 (giờ học buổi tối); các phiên đã được xếp vào khung tối, kèm cột **"Chưa xếp lịch"** (Đồ án microservice).
   > "Lịch rảnh của em là buổi tối và sáng cuối tuần, tối đa 150 phút mỗi ngày."

   Bấm **"Gợi ý lịch"**: hộp thoại báo **"Thiếu … trước deadline"** và đưa ra các cách bổ sung thời gian. Bấm "Để sau".
   > "Hệ thống không nhồi lịch vượt quỹ thời gian, mà báo rõ phần thiếu để em tự quyết định."
4. **Thử thay đổi → "Tôi bận chiều nay" → "Xem phương án mới".** Bản xem trước hiện ra: "Dành lại … cho bạn", phiên nào dời, phiên nào **không còn chỗ trước deadline** và vì sao.
   > "Lịch chưa đổi. Em chọn: giữ lịch hiện tại, hoặc áp dụng và đưa các phiên đó về Chưa xếp lịch."

   Bấm **"Áp dụng, đưa N phiên về Chưa xếp lịch"** (hoặc "Giữ lịch hiện tại" nếu muốn giữ dữ liệu demo).
   Kết quả phụ thuộc giờ demo: nếu demo sau 18:30 thì các phiên tối nay đã qua, nên chọn **"Một khoảng bận khác"** cho ngày mai.
5. **Lịch của tôi → nút "Tập trung" trên một phiên → "Bắt đầu" → "Kết thúc & ghi nhận".** Sau đó mở **Nhìn lại**: biểu đồ, mục "Theo từng môn học" và ô **"Dự kiến và thực tế"** cập nhật nhờ sự kiện `StudySessionCompleted` tới analytics-service (seed đã có một phiên dài hơn dự kiến 10 phút).
   > "Nếu các phiên thường kéo dài hơn dự kiến, trang gợi ý em ước lượng dư thời gian cho việc mới.
6. **Thời gian thực:** ở cửa sổ phải, **Thêm công việc** với hạn **ngày mai**. Chuông ở cửa sổ trái hiện chấm đỏ ngay, không cần tải lại. Bấm chuông: "Một vài điều cần nhớ" có lời nhắc mới.
   > "Đây là Server-Sent Events, chương 4."

### Phần B — Cơ chế phân tán (≈ 9 phút)

Chạy từng chương bằng `npm run demo -- chX`. Script in ra dòng **Nói:** để đọc theo, và dừng ở mỗi bước chờ Enter.

| Lệnh | Cho hội đồng thấy | Kết quả phải thấy | Phút |
|---|---|---|---|
| `ch2` | 7 container service; bảng tài khoản ↔ database; `task_app` đọc `user_db` bị từ chối; queue nào nhận sự kiện nào | `ERROR 1142 … SELECT command denied` | 1 |
| `ch3` | 300 công việc, 4 lần đề xuất song song trong worker threads; các request khác vẫn nhanh. Chỉ sang Grafana: panel *Planner* và *Event loop lag* | p95 vài chục ms, 0 lỗi | 1.5 |
| `ch4` | Một POST → log của 4 service có cùng `correlationId`; SSE nhận `event: notifications` | sự kiện tới sau vài trăm ms | 1 |
| `ch5` | UUID trong outbox; nội dung JWT; token bị sửa 1 ký tự → 401; `task-service` phân giải ra 2 IP; TLS 1.1 bị từ chối, 1.2/1.3 đạt; HTTP → 308 | `401 UNAUTHENTICATED`, `tls1_1: bị từ chối` | 1 |
| `ch6` | Hai tab sửa cùng bản ghi → `409 VERSION_CONFLICT`; sự kiện gửi trùng → tính 1 lần (log `event_duplicate_skipped`); bản xem trước đã cũ → `409 SIMULATION_STALE` | 3 kết quả như bên trái | 1 |
| `ch7` | Sao lưu ngay; replica đang chép và chỉ cho đọc; **xóa nhầm toàn bộ công việc** (primary và replica đều về 0) → khôi phục → trở lại | `12 → 0 → 12` (số tùy dữ liệu) | 2 |
| `ch8` | 2 bản sao chia tải; dừng 1 bản: 20/20 request vẫn 200, Prometheus bắn `ReplicasBelowDesired`; tiến trình crash → Docker khởi động lại; RabbitMQ sập → outbox giữ sự kiện và phát bù (xem panel Outbox); test circuit breaker | `20 200`, `RestartCount 0 → 1` | 2.5 |

Lưu ý khi demo:

- **`ch7` khôi phục cả 5 database về lúc sao lưu.** Giao diện có thể yêu cầu đăng nhập lại, vì refresh token cũng được khôi phục. Đó là đúng hành vi.
- **`ch8` dừng rồi bật lại container.** Sau đó chạy `npm run demo -- reset` nếu còn demo tiếp. Cảnh báo cần khoảng 30 giây để tự tắt.
- `ch4` thêm một vài công việc vào tài khoản demo. Muốn sạch lại thì chạy `npm run demo -- seed`.

### Bản rút gọn (8 phút)

Thứ tự ưu tiên khi bị cắt thời gian:

1. Phần A bước 1 (cứu kế hoạch), bước 3 (thiếu thời gian) và bước 6 (thời gian thực).
2. `ch8`: dừng bản sao và crash; bỏ phần tắt RabbitMQ.
3. `ch7`.
4. `ch6`.
5. `ch3`.

## 4. Nếu demo gặp sự cố

| Hiện tượng | Xử lý nhanh |
|---|---|
| Trình duyệt báo "Your connection is not private" | Gõ `thisisunsafe` trên trang (Chrome), hoặc tin cậy chứng chỉ (mục 1) |
| `check` báo service chưa healthy | `npm run demo -- reset`, chờ khoảng 30 giây |
| Đăng nhập demo thất bại | `npm run demo -- seed` |
| Không thấy thẻ Cứu kế hoạch | Đã lỡ tay xếp lại hoặc bỏ qua khi tập dượt: `npm run demo -- seed` tạo lại phiên bị lỡ |
| Replica không chép | `docker compose run --rm replica-setup` |
| Cảnh báo không bắn trong `ch8` | Mở http://localhost:9090/alerts và chờ thêm; giải thích ngưỡng `for: 30s` |
| Mọi thứ hỏng | Chuyển sang video đã quay hôm trước; vẫn giải thích được từng bước |

## 5. Câu hỏi có thể gặp

**Ứng dụng nhỏ, sao phải dùng microservice?**
Đề tài có mục tiêu học thuật là hệ phân tán. Em tách theo 5 nghiệp vụ có ranh giới dữ liệu rõ, không tách nhỏ hơn (bài học từ Uber). Với sản phẩm thật quy mô này, một modular monolith là đủ. Đổi lại, em phải trả giá bằng nhất quán cuối cùng và vận hành phức tạp hơn, và em đã chủ động xử lý các vấn đề đó.

**5 database nằm chung một MySQL thì có phải "database riêng" không? Đây có phải điểm lỗi duy nhất?**
Về ranh giới thì đúng là riêng: mỗi service một schema và một tài khoản, không đọc chéo được (demo `ch2`). Về vận hành thì vẫn chung một máy chủ MySQL, nên MySQL chính là điểm lỗi duy nhất. Hiện có replica để nâng lên thay thủ công (có ghi trong `docs/backup.md`) cùng bản sao lưu. Hướng tiếp theo là tách instance hoặc dùng InnoDB Cluster.

**Nếu planning chưa nhận được `TaskCreated` thì sao?**
Planning trả `409 TASK_NOT_SYNCED` thay vì đoán dữ liệu, và frontend tự thử lại. Đây là cái giá của nhất quán cuối cùng (chương 4 và 6, phần RabbitMQ sập).

**Sao không dùng Kafka?**
Bài toán cần định tuyến theo loại sự kiện, retry/DLQ theo từng consumer, và lưu lượng nhỏ. RabbitMQ topic exchange đáp ứng đủ và đơn giản để vận hành. Kafka phù hợp khi cần lưu lại luồng sự kiện để đọc lại từ đầu (replay, event sourcing) với lưu lượng lớn.

**Gửi sự kiện có bị mất hoặc bị trùng không?**
Không mất: outbox ghi cùng transaction với dữ liệu, publisher confirms, queue bền. Có thể giao trùng (at-least-once), nên phía nhận có inbox `processed_events` và chỉ ghi khi `aggregateVersion` mới hơn. Kết quả là xử lý đúng một lần (demo `ch6`).

**Hai người sửa cùng lúc thì sao?**
Dùng khóa lạc quan bằng `version`: người sau nhận 409 kèm bản hiện tại. Thao tác nhiều bước như áp dụng mô phỏng thì so dấu vân tay dữ liệu (`basis`) trong một transaction có khóa (`SELECT … FOR UPDATE`).

**Vì sao SSE mà không phải WebSocket?**
Thông báo chỉ đi một chiều từ server tới client. SSE chạy trên HTTP thường (qua Nginx và HTTP/2), có cơ chế kết nối lại, và không cần thư viện. Sự kiện chỉ báo "đã đổi", client lấy dữ liệu qua REST, nên không có đường thứ hai làm lộ dữ liệu.

**Lỡ một phiên học thì hệ thống xử lý thế nào? Thuật toán có tối ưu không?**
Phiên `planned` ở ngày đã qua là phiên bỏ lỡ: nó không còn giữ chỗ, nên phần việc đó được xếp lại khi em bấm "Xếp lại phần đã lỡ". Thuật toán là heuristic tham lam: ưu tiên deadline gần trước, và cố xong trước hạn 1 ngày. Ngày dự phòng chỉ được giữ khi không việc nào bị thiếu giờ nhiều hơn so với cách xếp sát deadline. Thuật toán không cam kết lịch tối ưu tuyệt đối, nhưng với deadline thì ưu tiên hạn gần trước là cách tốt để không trễ hạn. Sau khi lập chỉ mục phiên theo ngày, 500 việc tính trong khoảng 0,1 giây (trước đây khoảng 0,5 giây).

**Node.js đơn luồng thì "đa luồng" ở đâu?**
I/O chạy bất đồng bộ trên event loop. Phần tính toán nặng (planner) chạy trong `worker_threads` có pool, timeout và hàng đợi giới hạn. Đo được: event loop bị chặn 1612 ms → 12 ms.

**Token bị lộ thì sao?**
Access token chỉ sống 15 phút và chỉ nằm trong bộ nhớ. Refresh token nằm trong cookie HttpOnly, Secure, SameSite=Strict, và được xoay vòng mỗi lần dùng. Nếu một token cũ bị dùng lại, cả họ token bị thu hồi.

**Replica có thay được sao lưu không?**
Không. Lệnh xóa nhầm cũng được chép sang replica ngay lập tức (demo `ch7`: cả hai cùng về 0). Replica dùng khi máy hỏng, còn sao lưu dùng khi dữ liệu hỏng.

**Circuit breaker có tác dụng gì ở đây?**
Khi planning hoặc task chết, user-service (lúc đồng bộ Google Calendar) không phải chờ timeout cho từng người dùng và không dồn thêm tải lên service đang hỏng. Sau 30 giây, breaker cho một lần gọi thử để biết service đã hồi phục chưa.

**Làm sao biết hệ thống đang có vấn đề?**
Prometheus thu metrics từ mọi bản sao, có 8 luật cảnh báo (service mất, thiếu bản sao, broker ngắt, outbox tồn đọng, mạch mở, DLQ, tỉ lệ 5xx). Grafana hiển thị tổng quan. Log JSON có `correlationId` để lần theo một thao tác qua nhiều service (demo `ch4`).

## 6. Giới hạn nên chủ động nói

Tự nêu ra trước thường được đánh giá cao hơn là bị hỏi trúng:

- MySQL và RabbitMQ đều chạy một instance. Việc nâng replica lên thay MySQL chính đang làm thủ công.
- Chưa có auto-scaling, chưa gom log tập trung (ELK/Loki), chưa có Alertmanager gửi cảnh báo ra ngoài.
- TLS mới có từ trình duyệt tới gateway. Trong mạng Docker vẫn là kết nối thường, trừ replication MySQL.
- Nhắc việc chỉ hiện khi web đang mở trong một tab (trong ứng dụng hoặc qua thông báo của trình duyệt). Chưa có PWA và push server để nhắc khi đã đóng tab.
- Chưa có khóa phiên, phụ thuộc giữa các công việc và mô phỏng tăng thời lượng hoặc đổi ưu tiên (đặc tả FR06, FR11, FR13).
- SSE và giới hạn đăng nhập sai đang lưu trong bộ nhớ từng tiến trình. Nếu nhân bản notification-service hoặc user-service thì cần kênh dùng chung (RabbitMQ fanout, Redis).
- Thuật toán lập lịch là heuristic (deadline sớm trước), không cam kết tối ưu.
