# StudyBalance — frontend prototype

Giao diện tiếng Việt, gọi API của 5 service qua `/api/<service>` (Vite proxy khi dev, Nginx gateway khi chạy Compose). Cần đăng nhập; mỗi tài khoản bắt đầu trống. Cần backend chạy: xem README gốc.

## Chạy từ thư mục gốc

```sh
npm ci
npm run dev -w @studybalance/frontend
```

Mở http://localhost:5173. Nếu server đã chạy, chỉ cần tải lại trang.

```sh
npm run build -w @studybalance/frontend
npm run typecheck -w @studybalance/frontend
npm run test -w @studybalance/frontend
```

## Định hướng thiết kế

- Ảnh Intelly do người dùng cung cấp: sidebar đen, nền kem, bảng màu pastel, lịch và dashboard rõ thứ bậc.
- Ảnh Feather do người dùng cung cấp: tab hồ sơ, giấy kẻ ô và lời nhắn dạng sticky note.
- [MyStudyLife](https://mystudylife.com/tour/): nhóm môn học, công việc, deadline và tiến độ.
- [Sunsama Daily Planning](https://www.sunsama.com/daily-planning): tập trung vào việc tiếp theo, ước lượng thời gian, chia phiên và giữ quỹ thời gian thực tế.

Thiết kế riêng cho StudyBalance, không sử dụng logo hoặc hình ảnh thương hiệu của các sản phẩm tham khảo. Font Be Vietnam Pro được đóng gói local (Latin + Vietnamese). Icon cùng họ Phosphor. Màu môn học do người dùng chọn (hồng, xanh lam, vàng, xanh lá). Các hình trang trí là CSS và icon, không tải ảnh bên ngoài.

## Màn hình và thao tác

| Đường dẫn     | Nội dung                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| `#today`      | Phiên tiếp theo, tiến độ, nhóm việc ưu tiên, lịch tháng/ngày, ghi chú          |
| `#tasks`      | Thêm/sửa việc, hoàn thành/mở lại, tìm kiếm, lọc môn và trạng thái, sắp xếp     |
| `#calendar`   | Tuần/ngày trên desktop, lịch ngày trên mobile, chuyển tuần, xem chi tiết phiên |
| `#subjects`   | Thêm/sửa/xóa môn học, số công việc và liên kết đến danh sách đã lọc            |
| `#simulation` | Khoảng bận tùy chọn, so sánh trước/sau, rải sang nhiều ngày, áp dụng           |
| `#analytics`  | Biểu đồ tuần/tháng từ phiên đã ghi nhận, chuỗi ngày học, phân bổ theo môn      |
| `#settings`   | Tên, nhịp học, lịch rảnh tuần, lịch bận/ngày nghỉ, đổi mật khẩu, đăng xuất     |

Tìm kiếm toàn cục bằng nút tìm kiếm hoặc Cmd/Ctrl+K. Dialog dùng `<dialog>` native, hỗ trợ Escape và giữ focus trong cửa sổ. Phiên tập trung có bắt đầu/tạm dừng và nhập thời gian thực tế trước khi lưu. Ghi nhận phiên trừ số phút thực tế khỏi thời lượng còn lại (tối thiểu 0), không tự đánh dấu công việc hoàn thành. Bảng kế hoạch hỗ trợ đổi ngày/giờ trực tiếp và hoàn tác bỏ phiên nếu khung giờ vẫn hợp lệ.

## Dữ liệu và giới hạn

- `src/lib/api.ts`: access token chỉ giữ trong bộ nhớ, refresh token là cookie HttpOnly. Tải lại trang thì khôi phục phiên qua `/auth/refresh`. Khi gặp 401, client refresh một lần (các request đồng thời dùng chung) rồi gửi lại. Mã lỗi được đổi thành câu tiếng Việt.
- `src/lib/studyData.ts`: queries (hồ sơ, môn, việc, phiên học trong khoảng −35…+57 ngày, thông báo làm mới mỗi phút) và các thao tác ghi. Tạo mới dùng UUID do client sinh nên gửi lại không tạo bản trùng. `PATCH` gửi kèm `version`; nếu dữ liệu đã đổi ở nơi khác thì tải lại và báo cho người dùng.
- Đồng bộ qua sự kiện là bất đồng bộ: xếp phiên ngay sau khi tạo việc có thể nhận `TASK_NOT_SYNCED`, client tự thử lại. Thống kê và thông báo được tải lại sau mỗi lần ghi.
- Kết thúc phiên gồm hai bước: Planning ghi thời gian, rồi Task trừ thời lượng còn lại theo `sessionId`. Bước hai được thử lại; nếu vẫn lỗi, thời gian đã ghi được giữ và người dùng được báo.
- `src/data/schedule.ts` kiểm tra ràng buộc phía client để báo lỗi ngay. Planning Service vẫn là nơi kiểm tra cuối cùng.
- Mô phỏng "Hôm nay tôi bận" xem trước và áp dụng trên server. Nếu lịch đã đổi sau khi xem trước thì báo cần xem lại.
- Lịch rảnh theo tuần và lịch bận/ngày nghỉ chỉnh trong Cài đặt. Lịch tuần và lịch ngày tự giãn theo khung giờ, hiển thị phần ngoài giờ học và lịch bận.
- "Gợi ý lịch" (Lịch của tôi) gọi `POST /plans/generate`, hiện phần thiếu kèm cách xử lý (dời deadline, giảm thời lượng, thêm giờ, tăng giới hạn), rồi mới áp dụng khi người dùng đồng ý.
- "Thử thay đổi": bận chiều nay, nghỉ cả ngày, hoặc một khoảng bận bất kỳ trong 30 ngày tới. Phiên được chuyển sang ngày khác trước deadline; phần không xếp được có thể đưa về "Chưa xếp lịch". Có thể lưu khoảng bận vào lịch.
- Chi tiết công việc liệt kê phiên đã học. Phiên nào chưa trừ vào thời lượng có nút trừ lại. Cài đặt có đổi mật khẩu. Chưa có kéo thả.
- Có layout cho desktop, tablet và mobile; sidebar thu gọn, lịch tuần đổi thành agenda theo ngày. Tôn trọng prefers-reduced-motion.
