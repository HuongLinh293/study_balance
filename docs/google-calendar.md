# Kết nối Google Calendar với StudyBalance

## Phạm vi đồng bộ

- Google → StudyBalance: lấy **giờ bận** của các lịch được chọn, hiển thị trong lịch học và loại các khoảng đó khỏi gợi ý xếp lịch. Không nhập tên, mô tả, người tham dự hay địa điểm sự kiện cá nhân.
- StudyBalance → Google: tạo lịch riêng **StudyBalance**, đồng bộ tên công việc, giờ bắt đầu/kết thúc và trạng thái phiên học. Khi phiên được sửa hoặc bỏ khỏi lịch trong StudyBalance, bản tương ứng trên Google được cập nhật hoặc xóa ở lần đồng bộ tiếp theo.
- Phạm vi: hôm nay và 59 ngày tiếp theo, theo múi giờ Việt Nam. Các sự kiện đã xuất trong quá khứ được giữ làm lịch sử.
- Đồng bộ nền mỗi khoảng 5 phút khi user-service chạy (worker kiểm tra mỗi phút), kể cả khi đóng trình duyệt. Có nút **Đồng bộ ngay**.
- Chỉnh sửa phiên học tại StudyBalance. Không nhập ngược thao tác sửa/xóa sự kiện Google thành thay đổi phiên học. Lịch StudyBalance do app tạo không được dùng làm nguồn giờ bận để tránh tự chặn chính các phiên học.
- Lịch Google mới trùng phiên đã có sẽ được báo trong Cài đặt. App không tự dời phiên; dùng **Thử thay đổi**.
- Khi đồng bộ lỗi, giữ bản giờ bận đã biết và hiển thị lỗi/lần đồng bộ thành công gần nhất. Dữ liệu này có thể đã cũ; ngoài phạm vi 60 ngày chưa được kiểm tra với Google.
- Ngắt kết nối bỏ token và giờ bận nhập từ Google, giữ công việc/phiên học và các sự kiện đã xuất. Nếu endpoint thu hồi quyền của Google lỗi, UI hướng dẫn gỡ quyền thủ công.

## 1. Tạo Google Cloud project

1. Mở https://console.cloud.google.com/ và tạo/chọn project dành cho StudyBalance.
2. Vào **APIs & Services → Library**, tìm **Google Calendar API**, chọn **Enable**.
3. Mở **Google Auth Platform** và hoàn tất phần thiết lập:
   - **Branding**: đặt tên app StudyBalance, email hỗ trợ và email liên hệ.
   - **Audience**: chọn External nếu dùng nhiều loại tài khoản; để Testing khi phát triển.
   - **Test users**: thêm email Google sẽ dùng để kết nối. Tài khoản trường có thể bị quản trị viên giới hạn ứng dụng bên ngoài.
4. Trong **Data Access**, khai báo các scope:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email` (email)
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.app.created`

Không cần quyền chỉnh sửa toàn bộ lịch cá nhân. Quyền ghi giới hạn vào lịch phụ do ứng dụng tạo.

## 2. Tạo OAuth Client

Trong **Clients → Create client**:

- Application type: **Web application**.
- Name: StudyBalance Local.
- Authorized redirect URIs, nhập đúng:

```text
http://localhost:8088/api/user/integrations/google/callback
```

Đây là luồng OAuth backend, không cần Authorized JavaScript origins. Nếu đổi cổng/domain, cập nhật cả redirect URI trên Google và `APP_PUBLIC_URL`. Khi thử kết nối phải mở đúng `http://localhost:8088`, không đổi sang `127.0.0.1` giữa luồng vì cookie bảo vệ OAuth được gắn với host.

Lưu Client ID và Client Secret ở nơi riêng tư. Không đưa chúng vào frontend, ảnh chụp công khai, commit hoặc chat.

## 3. Cấu hình Docker local

Mở `.env` ở thư mục gốc và điền:

```dotenv
GOOGLE_CLIENT_ID=client-id-do-google-cap.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=client-secret-do-google-cap
APP_PUBLIC_URL=http://localhost:8088
```

`GOOGLE_TOKEN_ENCRYPTION_KEY` đã được tạo ngẫu nhiên cho môi trường local trong lần triển khai tính năng. Giữ nguyên khóa này; đổi/mất khóa sẽ không đọc được refresh token đang lưu. File `.env` được bỏ qua khi commit và khi build Docker.

Với một bản cài mới chưa có khóa, tạo 32 byte ngẫu nhiên rồi điền kết quả vào biến này:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Sau khi điền các giá trị:

```sh
docker compose up -d --no-deps user-service
```

Nếu đang cài tính năng từ mã nguồn lần đầu:

```sh
docker compose up -d --build user-service frontend gateway
```

Không cần xóa volume hay reset database. Migration tự thêm các bảng tích hợp.

Nếu chạy bằng npm thay vì Docker, điền các biến trên vào `services/user-service/.env`, đặt `APP_PUBLIC_URL=http://localhost:5173` và thêm redirect URI tương ứng ở Google. URL nội bộ mặc định của task/planning service là `localhost:3002` và `localhost:3003`.

## 4. Kết nối trong app

1. Vào **Cài đặt → Google Calendar**, chọn **Kết nối Google Calendar**.
2. Đăng nhập tài khoản đã thêm vào Test users và cấp các quyền được app yêu cầu.
3. Sau khi quay lại app, chọn những lịch cần lấy giờ bận. Mặc định là lịch chính.
4. Chọn **Lưu lựa chọn và đồng bộ** hoặc **Đồng bộ ngay**.
5. Kiểm tra lịch Google mới tên StudyBalance và các vùng **Bận · Google Calendar** trong app.

Để kiểm tra luồng: tạo một sự kiện bận trên lịch Google nguồn, đồng bộ và xem giờ đó bị chặn trong gợi ý. Tạo/sửa/bỏ một phiên học trong StudyBalance, đồng bộ và kiểm tra bản tương ứng trên lịch Google riêng.

## Vận hành và giới hạn

- OAuth dùng state một lần, thời hạn 10 phút, cookie HttpOnly/SameSite, PKCE và xác minh ID token. Refresh token mã hóa AES-256-GCM với khóa riêng, gắn với từng user; frontend không nhận token Google.
- Gateway tắt access log cho callback OAuth để không lưu authorization code trong URL. Các lỗi Google gửi ra client đã được lược bỏ dữ liệu nhạy cảm.
- Kết nối/sync/ngắt kết nối được khóa theo user trong MySQL để tránh hai worker ghi đồng thời. Event ID được lưu trước khi gọi Google để retry không tạo bản sao.
- Worker giao tiếp với planning/task qua API nội bộ và token của chính user, không đọc database service khác.
- Danh sách lịch có phân trang; tối đa chọn 20 lịch. Khoảng bận giao nhau được gộp, sự kiện cả ngày và qua nửa đêm được tách theo ngày Việt Nam.
- Chưa dùng webhook: không cần domain HTTPS công khai để thử local. Khi triển khai production dùng HTTPS, đặt `COOKIE_SECURE=true`, và cấu hình lại OAuth redirect URI.
- Ở chế độ External/Testing, refresh token cho các scope Calendar thường hết hạn sau 7 ngày; kết nối lại khi app yêu cầu. Khi mở cho người dùng ngoài danh sách test, cần hoàn tất quy trình xuất bản/xác minh tương ứng của Google.
- Chưa thể xác minh với tài khoản Google thật nếu chưa có OAuth Client và bước cấp quyền của chủ tài khoản.

## Tài liệu chính thức

- OAuth web-server: https://developers.google.com/identity/protocols/oauth2/web-server
- Scope Calendar: https://developers.google.com/workspace/calendar/api/auth
- FreeBusy: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Tạo sự kiện: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- OAuth token expiration: https://developers.google.com/identity/protocols/oauth2#expiration
