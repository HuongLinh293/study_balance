# Nội dung slide báo cáo tiến độ — StudyBalance

Thời lượng gợi ý: 8–10 phút, gồm 1–2 phút demo. Nội dung phản ánh mã nguồn hiện tại; không quy đổi số màn hình thành phần trăm hoàn thành toàn đề tài.

## Slide 1 — Báo cáo tiến độ đề tài

**StudyBalance — Kế hoạch thay đổi cùng bạn**

Xây dựng trợ lý lập kế hoạch học tập cá nhân cho sinh viên theo kiến trúc Microservices hướng sự kiện.

- Sinh viên thực hiện: Linh.
- Giai đoạn báo cáo: phân tích, xây dựng bộ khung và frontend prototype.
- Trọng tâm: trải nghiệm lập kế hoạch và mô phỏng thay đổi lịch.

Lời nói: “Trong giai đoạn này, em tập trung làm rõ bài toán và xây dựng prototype có tương tác để kiểm chứng luồng sử dụng trước khi tích hợp backend.”

## Slide 2 — Lý do chọn đề tài

**Xuất phát từ nhu cầu quản lý thời gian học tập của sinh viên.**

- Sinh viên phải cân đối nhiều môn học, bài tập, kỳ thi và lịch cá nhân.
- Danh sách công việc và deadline chưa giúp xác định rõ nên học gì, khi nào và trong bao lâu.
- Khi có lịch bận hoặc tiến độ chậm, cần điều chỉnh kế hoạch phù hợp với thời gian thực tế.
- Đề tài tạo cơ hội vận dụng kiến trúc Microservices và giao tiếp hướng sự kiện vào một bài toán gần gũi.

Lời nói: “Em chọn đề tài vì nhu cầu quản lý việc học gắn trực tiếp với trải nghiệm của sinh viên. Đồng thời, bài toán có các nghiệp vụ tài khoản, công việc, lập lịch, thông báo và thống kê phù hợp để nghiên cứu cách tách dịch vụ và đồng bộ dữ liệu.”

## Slide 3 — Mục tiêu và phạm vi

**Mục tiêu**

- Xây dựng website hỗ trợ sinh viên lập và theo dõi kế hoạch học tập cá nhân.
- Phân bổ công việc thành phiên học theo deadline, thời lượng và quỹ thời gian.
- Hỗ trợ mô phỏng thay đổi lịch, xem trước tác động rồi xác nhận áp dụng.
- Vận dụng kiến trúc Microservices hướng sự kiện và kiểm thử khả năng đồng bộ, chịu lỗi.

**Phạm vi**

- Đối tượng: sinh viên sử dụng cá nhân; giao diện web responsive.
- Chức năng chính: tài khoản, môn học, công việc, lịch học, ghi nhận tiến độ, thông báo và thống kê.
- Chưa đưa vào bản đầu: làm việc nhóm, AI chatbot, ứng dụng native và đồng bộ Google Calendar.

Ghi chú trình bày: Đây là mục tiêu toàn đề tài. Giai đoạn hiện tại tập trung vào frontend với mock data; chưa hoàn thành các nghiệp vụ backend và thuật toán lập lịch tổng quát.

## Slide 4 — Kiến trúc frontend, backend và công nghệ

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | React.js + TypeScript | Xây dựng giao diện và tương tác |
| Giao diện & công cụ build | CSS/Tailwind CSS, Vite | Thiết kế responsive, chạy phát triển và build |
| Backend | Node.js + Express + TypeScript | Cung cấp REST API và xử lý nghiệp vụ |
| Kiến trúc dịch vụ | 5 microservice | User, Task, Planning, Notification, Analytics |
| Cơ sở dữ liệu | MySQL | Lưu dữ liệu, tách quyền sở hữu theo service |
| Giao tiếp sự kiện | RabbitMQ | Trao đổi sự kiện bất đồng bộ giữa các service |
| Đóng gói & triển khai | Docker, Docker Compose, Nginx | Đóng gói, chạy các thành phần và định tuyến yêu cầu |

**Luồng dự kiến:** Trình duyệt → Frontend → Nginx → REST API của các service → MySQL; các service trao đổi sự kiện qua RabbitMQ.

**Hiện trạng:** frontend chạy với mock data/localStorage; backend mới có bộ khung và `/health`. Đã có cấu hình hạ tầng, chưa kết nối database/broker và chưa tích hợp API nghiệp vụ.

Gợi ý bố cục: ba khối Frontend — Backend — Hạ tầng; phần kết nối dự kiến dùng nét đứt.

Lời nói: “Frontend của em dùng React kết hợp TypeScript. Backend dùng Node.js và Express, chia thành năm microservice. MySQL lưu dữ liệu, RabbitMQ phục vụ giao tiếp hướng sự kiện. Docker dùng để đóng gói và triển khai các thành phần, không thay thế công nghệ xử lý backend.”

## Slide 5 — Kết quả frontend hiện tại

**Đã xây dựng 7 màn hình với dữ liệu mẫu và thao tác local.**

- Hôm nay: công việc ưu tiên, phiên tiếp theo, tiến độ và lịch.
- Công việc, Môn học: thêm/sửa công việc, lọc, tìm kiếm, đánh dấu trạng thái; môn học hiện dùng danh mục mẫu.
- Lịch của tôi: bảng kế hoạch, lịch tuần/ngày và xếp phiên thủ công.
- Thử thay đổi: mô phỏng lịch bận, so sánh và áp dụng.
- Nhìn lại, Cài đặt: biểu đồ mẫu và thiết lập nhịp học.

Dòng chú thích trên slide: **Mock data · localStorage · Chưa gọi API backend**.

Hình gợi ý: ảnh màn Hôm nay và Bảng kế hoạch.

## Slide 6 — Luồng lập kế hoạch đã triển khai

**Chưa xếp lịch → Kế hoạch trong ngày → Lịch theo giờ.**

- Thêm công việc, deadline và thời lượng còn lại.
- Chọn ngày, giờ bắt đầu và số phút cho phiên học.
- Kiểm tra trùng giờ, khoảng nghỉ, giới hạn ngày và deadline.
- Đổi lịch trực tiếp; bỏ phiên và hoàn tác nếu khung giờ vẫn hợp lệ.
- Ghi nhận số phút học để giảm thời lượng còn lại; người dùng xác nhận hoàn thành công việc riêng.

Giới hạn: thao tác trên ngày mẫu 24–26/10/2026; chưa sinh lịch tự động cho toàn bộ công việc.

## Slide 7 — Mô phỏng “Hôm nay tôi bận”

**Xem phương án trước khi thay đổi lịch đang dùng.**

1. Chọn bận buổi chiều hoặc phần còn lại của ngày mẫu.
2. Xác định các phiên chưa hoàn thành bị ảnh hưởng.
3. Thử chuyển phiên sang ngày tiếp theo trong giới hạn cho phép.
4. Hiển thị phương án và phần chưa xếp được.
5. Chỉ áp dụng khi phương án khả thi và người dùng xác nhận.

Đã có: xử lý frontend cho kịch bản mẫu, giữ phiên đã học, kiểm tra deadline và quỹ thời gian.

Chưa có: thuật toán tổng quát, lưu ngoại lệ bận ở backend, kiểm soát phiên bản và đồng bộ giữa service.

## Slide 8 — Cải thiện UI/UX và kiểm thử

**Đã sửa các vấn đề phát hiện qua review giao diện.**

- Phân biệt “Công việc đã xong” và “Phiên đã học”.
- Ghi nhận phiên cập nhật thời lượng còn lại, tránh tăng lại phần chưa xếp.
- Tăng cỡ chữ ở bảng kế hoạch; thêm đổi lịch và hoàn tác.
- Thêm lối tắt xếp việc trên mobile; khối lịch phản ánh thời lượng phiên.

Kết quả kỹ thuật tại lần kiểm tra gần nhất:

- Frontend TypeScript và production build thành công.
- **8/8 unit tests đạt** cho mô phỏng, ràng buộc xếp lịch và ghi nhận tiến độ.
- Chưa hoàn tất kiểm tra trực quan mọi breakpoint và kiểm thử với người dùng thật.

Ghi chú: 8 tests không đồng nghĩa đã kiểm thử toàn hệ thống hoặc end-to-end.

## Slide 9 — Hạn chế và công việc còn lại

| Hạng mục | Trạng thái hiện tại |
|---|---|
| Phân tích yêu cầu, thiết kế kiến trúc | Đã có tài liệu định hướng |
| Frontend | Prototype tương tác với dữ liệu mẫu |
| Backend | Bộ khung và endpoint health |
| Database, xác thực, API nghiệp vụ | Chưa triển khai |
| RabbitMQ, outbox/inbox, retry, idempotency | Chưa triển khai |
| Lập lịch tổng quát, cứu kế hoạch | Chưa triển khai đầy đủ |
| Kiểm thử tích hợp và chịu lỗi | Chưa thực hiện |

Rủi ro chính: phạm vi 5 service lớn với một người thực hiện; dữ liệu giữa các service có thể đến chậm hoặc lặp; cần ưu tiên luồng nghiệp vụ xuyên suốt trước tính năng mở rộng.

## Slide 10 — Kế hoạch giai đoạn tiếp theo

**Ưu tiên một luồng hoàn chỉnh từ giao diện đến dữ liệu thật.**

1. Chốt mô hình dữ liệu, API và hợp đồng sự kiện.
2. Triển khai User và Task: xác thực, lưu công việc, phân quyền dữ liệu.
3. Triển khai Planning: lịch rảnh, đề xuất kế hoạch, xem trước và xác nhận.
4. Kết nối Notification, Analytics qua sự kiện; bổ sung outbox/inbox, chống xử lý lặp và retry.
5. Tích hợp frontend; kiểm thử end-to-end, đồng bộ chậm, lỗi broker và xung đột phiên bản.

Tiêu chí mốc tiếp theo: tạo công việc từ giao diện → lưu database → phát/nhận sự kiện → hiển thị trạng thái có thể kiểm chứng bằng log và test.

Kết lời: “Kết quả hiện tại là nền tảng giao diện và luồng tương tác. Giai đoạn tiếp theo sẽ chuyển các luồng này sang backend và kiểm chứng các yêu cầu của hệ thống phân tán.”

## Kịch bản demo 1–2 phút

Dùng origin/profile thử nghiệm riêng để không thay đổi dữ liệu đang sử dụng.

1. Mở Hôm nay, giới thiệu công việc và thời lượng trong ngày.
2. Tạo việc mẫu 30 phút, deadline 26/10/2026.
3. Mở Bảng kế hoạch, chọn một giờ còn trống; giải thích ràng buộc nếu giờ bị từ chối.
4. Đổi giờ của phiên; chỉ ra thao tác hoàn tác khi bỏ phiên.
5. Mở Thử thay đổi, xem phương án trước/sau và phần chưa xếp được nếu có.

Nếu không đủ thời gian, chỉ demo bước 1, 3, 5. Không trình bày notification mẫu như gửi thông báo thật hoặc thống kê seed như dữ liệu sử dụng thực.

## Nguồn đối chiếu

- `StudyBalance_Chi_tiet_de_tai.md`: mục tiêu, phạm vi và kiến trúc dự kiến.
- `frontend/README.md` và mã nguồn frontend: chức năng prototype và giới hạn.
- `services/*/src/app.ts`: bộ khung backend hiện tại.
- Kết quả kiểm tra gần nhất: frontend build thành công, 8 tests đạt.

Lưu ý: README ở thư mục gốc còn mô tả frontend ở thời điểm scaffold; không dùng câu “chỉ có trang khởi động” để báo cáo trạng thái frontend hiện tại.
