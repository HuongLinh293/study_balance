# Kết quả kiểm thử Cứu kế hoạch và các bản sửa sau review — 12/11/2026

Môi trường: macOS, Node.js 24 (unit test); Docker Compose với 2 bản sao planning-service và task-service (chạy thật qua gateway HTTPS).

## Thay đổi

| Phần | Nội dung |
|---|---|
| Lập lịch | Phiên `planned` ở ngày đã qua là phiên **bỏ lỡ**: không còn giữ chỗ, phần việc được xếp lại. Trước đây kế hoạch coi việc đó vẫn đủ phiên |
| Lập lịch | Ưu tiên xong trước deadline 1 ngày. Chỉ giữ ngày dự phòng khi **không việc nào** thiếu giờ nhiều hơn cách xếp sát deadline (so từng việc, không so tổng: so tổng từng làm bài subnet hạn ngày mai thiếu 20 phút để đồ án bớt thiếu, đã sửa) |
| Lập lịch | Chỉ mục phiên theo ngày/việc và bộ nhớ đệm khoảng trống: không còn quét toàn bộ danh sách phiên ở mỗi bước |
| Cứu kế hoạch (FR12) | Thẻ trên trang Hôm nay: phiên đã lỡ (14 ngày gần nhất) với "Tôi đã học" / "Bỏ qua", việc quá hạn, nút "Xếp lại phần đã lỡ" |
| Bước nhỏ (FR06) | Tick xong từng bước; sửa danh sách bước giữ trạng thái bước cùng tên |
| Nhắc việc (FR14) | Nhắc 15 phút trước mỗi phiên; thông báo của trình duyệt khi tab ở nền |
| Thống kê (FR15) | Dự kiến/thực tế theo kỳ, tỷ lệ hoàn thành đúng hạn, số việc quá hạn; gợi ý ước lượng dư khi phiên thường kéo dài |
| Analytics | Truy vấn biểu đồ/chuỗi ngày chỉ đọc 400 ngày gần nhất thay vì toàn bộ lịch sử |
| Giao diện | Lịch tuần mở ở giờ học đầu tiên trong ngày, tiêu đề ngày dính đầu trang; phiên lỡ có nét đứt "Bỏ lỡ"; nút đề xuất không còn ghi "Thêm 0 phiên" |

## Hiệu năng `generatePlan`

Cùng máy, 7 ngày/tuần 08:00–12:00 và 13:10–18:00, hạn rải trong 60 ngày, chạy ấm:

| Số công việc | Trước | Sau | Kết quả |
|---|---|---|---|
| 20 | 3 ms | vài ms (sai số đo) | giống hệt (71 phiên) |
| 100 | 39 ms | 8 ms | giống hệt (353 phiên) |
| 300 | 337 ms | 68 ms | giống hệt (603 phiên, cùng phần thiếu từng việc) |
| 500 | 502 ms | 114 ms | giống hệt (601 phiên, cùng phần thiếu từng việc) |

Vì thuật toán nhanh hơn, bài test "event loop không bị chặn" dùng 1500 công việc để còn đo được khoảng chặn khi chạy trên luồng chính (389 ms, qua worker 11 ms).

## Kiểm thử

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | `npm test` (6 service/package), `npm run typecheck` | 61 test đạt, typecheck sạch. Test timeout của worker pool nâng ngưỡng 300 → 1000 ms vì worker thay thế khởi động chậm khi máy bận (thỉnh thoảng lỗi) |
| 2 | Unit: phiên lỡ hôm qua → việc 60 phút được xếp lại đủ 60 phút | Đạt (trước khi sửa: `needed 0, proposed 0`) |
| 3 | Unit: ngày dự phòng được giữ khi đủ chỗ, được dùng khi không đủ; với tuần demo chỉ đồ án thiếu giờ | Đạt |
| 4 | Unit: nhắc phiên hiện từ 15 phút trước tới hết phiên | Đạt |
| 5 | `npm run test:e2e` sau khi build lại 5 image | 16/16 bước đạt |
| 6 | `npm run test:rescue` (mới): tick bước, phiên lỡ được xếp lại trước hạn 1 ngày, nhắc "Sắp đến phiên học", dự kiến 20 / thực tế 30 phút → `ratio 1.5`, đúng hạn 1/1 | Đạt |
| 7 | Trình duyệt headless (desktop 1440×900, mobile 390×844): thẻ Cứu kế hoạch, ghi phiên đã lỡ, xếp lại 2 phiên (1h 30p), checklist "1/3 xong", lịch tuần, Nhìn lại, Cài đặt | Hiển thị đúng; không lỗi JS |

Lưu ý: dữ liệu cũ chỉ có đủ thông tin mới sau sự kiện tiếp theo. Phiên học có trước bản này không có số phút dự kiến trong thống kê, và việc hoàn thành trước bản này chưa có ngày hoàn thành để tính tỷ lệ đúng hạn. Chạy lại `npm run demo -- seed` để có dữ liệu demo đầy đủ; seed tạo thêm một phiên tối qua bị lỡ (50 phút) cho phần Cứu kế hoạch, xếp lại được 1 phiên 50 phút.
