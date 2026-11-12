# Deploy lên Oracle Cloud Always Free

Toàn bộ hệ thống (5 service, MySQL chính và replica, RabbitMQ, Nginx, Prometheus, Grafana) chạy trên **một VM ARM miễn phí** bằng chính `docker-compose.yml`, cộng thêm [`docker-compose.prod.yml`](../docker-compose.prod.yml):

- Chỉ gateway mở ra Internet: cổng 80 (chuyển hướng và xác minh Let's Encrypt) và 443 (ứng dụng).
- MySQL, RabbitMQ, Prometheus, Grafana chỉ nghe trên `127.0.0.1` của VM, truy cập qua SSH.
- Chứng chỉ HTTPS thật của Let's Encrypt, tự gia hạn hằng tuần.
- `.env` sinh mật khẩu ngẫu nhiên cho mọi tài khoản (root MySQL, từng service, RabbitMQ, JWT, Grafana).

Hệ thống dùng khoảng 2 GB RAM khi chạy.

## 1. Tạo tài khoản và VM (làm trên web, khoảng 20 phút)

1. Đăng ký tại https://signup.cloud.oracle.com. Cần thẻ Visa/Mastercard để xác minh; gói Always Free không trừ tiền.
   **Home region không đổi được sau này.** Nên chọn **Singapore** hoặc **Japan East (Tokyo)** cho gần Việt Nam.
2. Tạo khóa SSH trên máy của bạn (nếu chưa có):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/oracle_studybalance
   ```
3. Console → **Compute → Instances → Create instance**:
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Change shape → Ampere → `VM.Standard.A1.Flex`, **2 OCPU, 8 GB RAM** (nằm trong hạn mức miễn phí 4 OCPU / 24 GB).
     Không nên chọn quá nhiều RAM: Oracle có thể thu hồi máy Always Free "nhàn rỗi" (CPU, mạng và bộ nhớ đều dưới 20% trong 7 ngày); 2 GB / 8 GB vẫn trên ngưỡng bộ nhớ.
   - **Networking:** để mặc định (tạo VCN mới), chọn **Assign a public IPv4 address**.
   - **Add SSH keys:** Upload public key `~/.ssh/oracle_studybalance.pub`.
   - **Boot volume:** mặc định 50 GB là đủ (miễn phí tới 200 GB).

   Nếu báo **"Out of capacity"**: máy ARM miễn phí đang hết ở vùng đó. Thử Availability Domain khác, hoặc thử lại sau vài giờ.
4. Mở cổng web: trang instance → **Primary VNIC → Subnet → Security Lists → Default Security List → Add Ingress Rules**, thêm 2 rule:
   - Source CIDR `0.0.0.0/0`, TCP, Destination port `80`
   - Source CIDR `0.0.0.0/0`, TCP, Destination port `443`
5. Ghi lại **Public IP** của instance.

## 2. Tên miền

Let's Encrypt cần một tên miền. Không có tên miền riêng thì dùng tên miền miễn phí:

- **sslip.io** (không cần đăng ký): IP `140.238.1.2` → `140-238-1-2.sslip.io`.
- **DuckDNS** (https://www.duckdns.org, đăng nhập bằng GitHub/Google): tạo `studybalance-xyz.duckdns.org` trỏ về Public IP. Dùng khi sslip.io bị giới hạn số lần cấp chứng chỉ.

Kiểm tra trước khi tiếp tục: `ping <tên miền>` phải ra đúng Public IP.

## 3. Cài đặt trên VM (khoảng 15 phút, phần lớn là build)

```bash
ssh -i ~/.ssh/oracle_studybalance ubuntu@<Public IP>
git clone https://github.com/HuongLinh293/study_balance.git
cd study_balance
bash scripts/deploy/server.sh setup <tên miền> [email nhận thông báo hết hạn chứng chỉ]
```

`setup` cài Docker và Node.js, mở cổng 80/443 trong iptables của máy, tạo `.env`. Lần đầu Docker vừa được cài nên script dừng và nhắc **thoát SSH, đăng nhập lại**, rồi chạy:

```bash
cd study_balance
bash scripts/deploy/server.sh up     # build 6 image và khởi động, chờ mọi service healthy
bash scripts/deploy/server.sh cert   # lấy chứng chỉ Let's Encrypt, hẹn gia hạn hằng tuần
```

Mở `https://<tên miền>`: ổ khóa hợp lệ, đăng ký tài khoản được.

Tạo tài khoản demo trên server:

```bash
npm run demo -- seed
npm run demo -- check
```

## 4. Vận hành

| Việc | Lệnh (trên VM, trong thư mục `study_balance`) |
|---|---|
| Xem trạng thái | `bash scripts/deploy/server.sh status` |
| Cập nhật code mới từ GitHub | `bash scripts/deploy/server.sh update` |
| Xem log một service | `docker compose logs -f planning-service` |
| Sao lưu ngay | xem [backup.md](backup.md); bản sao lưu nằm trong `backups/` trên VM |
| Gia hạn chứng chỉ thủ công | `bash scripts/deploy/server.sh cert` |

Grafana, Prometheus và RabbitMQ không mở ra Internet. Mở đường hầm SSH từ máy của bạn rồi dùng như khi chạy local:

```bash
ssh -i ~/.ssh/oracle_studybalance -N \
  -L 3030:127.0.0.1:3030 -L 9090:127.0.0.1:9090 -L 15672:127.0.0.1:15672 ubuntu@<Public IP>
```

- Grafana: http://localhost:3030, tài khoản `admin`, mật khẩu là `GRAFANA_ADMIN_PASSWORD` trong `.env` trên VM.
- Prometheus: http://localhost:9090
- RabbitMQ: http://localhost:15672, `studybalance` / `RABBITMQ_DEFAULT_PASS` trong `.env` trên VM.

## 5. Đăng nhập Google (tùy chọn)

Mặc định tắt. Muốn bật: điền `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` vào `.env` trên VM. Sau đó thêm redirect URI dùng `https://<tên miền>` trong Google Cloud Console (xem [google-calendar.md](google-calendar.md)) và chạy `bash scripts/deploy/server.sh up`.

## 6. Giới hạn

- Một VM duy nhất: các bản sao service, replica MySQL và backup cùng nằm trên một máy, nên máy hỏng thì cả hệ thống dừng. Bản sao lưu nên được tải về máy khác định kỳ (`scp`).
- Oracle có thể thu hồi VM Always Free nếu nhàn rỗi lâu; nâng tài khoản lên Pay As You Go (vẫn không mất phí trong hạn mức free) sẽ bỏ giới hạn này.
