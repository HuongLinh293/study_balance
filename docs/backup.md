# Sao lưu và khôi phục dữ liệu

Mỗi service sở hữu một database riêng trên MySQL (`user_db`, `task_db`, `planning_db`, `notification_db`, `analytics_db`). Container `backup` trong Compose sao lưu cả năm database theo lịch; `scripts/restore-db.sh` khôi phục từ một lượt sao lưu.

## Cách hoạt động

```text
backup (mysql:8.4, infrastructure/backup/backup.sh)
  │ mỗi BACKUP_INTERVAL_SECONDS (mặc định 86400 = 1 ngày), chạy ngay khi khởi động
  │ mysqldump --single-transaction  ← snapshot InnoDB nhất quán, không khóa ghi của service
  ▼
backups/<UTC timestamp>/
  user_db.sql.gz  task_db.sql.gz  planning_db.sql.gz  notification_db.sql.gz  analytics_db.sql.gz
  SHA256SUMS
```

- Một lượt được ghi vào thư mục tạm `.…partial`, kiểm tra `gzip -t`, tính SHA-256 rồi mới đổi tên. Lượt lỗi giữa chừng không bao giờ xuất hiện như một bản sao lưu hợp lệ.
- Giữ `BACKUP_KEEP` lượt mới nhất (mặc định 7), lượt cũ bị xóa.
- Lượt lỗi được ghi log `backup_failed`, bộ lập lịch vẫn chạy tiếp. Log dạng JSON giống các service: `docker compose logs backup`.
- Mật khẩu truyền qua `MYSQL_PWD`, không xuất hiện trên dòng lệnh.

## Lệnh

```sh
npm run backup:now                          # sao lưu ngay một lượt
npm run backup:restore                      # khôi phục lượt mới nhất, cả năm database (hỏi xác nhận)
npm run backup:restore -- 20261110T132118Z  # khôi phục một lượt cụ thể
npm run backup:restore -- --yes <lượt> task_db   # chỉ một database, không hỏi (dùng khi dev)
```

Script khôi phục:

1. Kiểm tra checksum. File hỏng thì dừng trước khi đụng vào database.
2. Dừng các service sở hữu database đó nếu đang chạy trong Compose. Khi chạy `npm run dev`, tự dừng service trước.
3. `DROP DATABASE` rồi nạp lại bản dump, nên database trở về đúng trạng thái lúc sao lưu. Tài khoản riêng của service (`task_app`, …) giữ nguyên quyền.
4. Bật lại service. Service chỉ healthy khi `/ready` xác nhận được DB và broker.

## Vì sao nên khôi phục cả lượt

Các service đồng bộ qua sự kiện có `aggregateVersion`, và consumer bỏ qua phiên bản không mới hơn bản đang giữ. Nếu chỉ khôi phục `task_db` về hôm qua mà giữ `planning_db` hiện tại, Task Service sẽ phát lại các số phiên bản cũ và Planning sẽ bỏ qua chúng. Khôi phục cả lượt đưa producer, projection, outbox và inbox về cùng một mốc.

Mỗi database được dump trong một transaction riêng, lần lượt trong vài giây. Vì vậy một lượt chưa phải snapshot đồng thời tuyệt đối của toàn hệ thống. Sau khi khôi phục, sự kiện còn trong hàng đợi RabbitMQ vẫn được xử lý idempotent nhờ inbox và `upsertIfNewer`.

## Chỉ số

- RPO (dữ liệu có thể mất): tối đa một chu kỳ sao lưu, mặc định 24 giờ.
- RTO (thời gian khôi phục) với dữ liệu demo khoảng 74 KB nén: vài giây cho DB, khoảng 15 giây đến khi các service healthy lại.

## Replica (MySQL Replication)

```text
mysql (primary, server_id=1)  ──binlog + GTID──▶  mysql-replica (server_id=2, super_read_only)
        ▲  services ghi/đọc                              127.0.0.1:3307, chỉ đọc
        └── replica-setup (chạy một lần mỗi khi `docker compose up`)
```

- Bật GTID trên primary ([primary.cnf](../infrastructure/mysql/conf/primary.cnf)), replica dùng `SOURCE_AUTO_POSITION=1`. Replica tự biết đã áp dụng tới giao dịch nào, nên khi tắt/bật lại sẽ tự chép bù, không cần chỉ vị trí binlog thủ công.
- [replica-setup.sh](../infrastructure/mysql/replica-setup.sh) chạy idempotent:
  - Nếu replication đang chạy thì không làm gì.
  - Nếu chưa có hoặc bị lỗi: tạo tài khoản `repl` (chỉ quyền `REPLICATION SLAVE`) và chép snapshot nhất quán của 5 database (`mysqldump --set-gtid-purged=ON`).
  - Sau đó bắt đầu replication qua kết nối TLS và đặt `super_read_only` để không ai ghi nhầm vào replica.
- Replica có sẵn năm database và năm tài khoản service giống primary, để có thể nâng lên thay primary khi cần.
- Khôi phục backup trên primary (`DROP DATABASE` + nạp dump) cũng được nhân bản sang replica, nên hai bên luôn khớp.

```sh
npm run replica:status        # Replica_IO/SQL_Running, Seconds_Behind_Source, GTID đã áp dụng
docker compose run --rm replica-setup   # chạy lại khi replica báo lỗi (sẽ seed lại từ primary)
```

Replica **không thay thế sao lưu**: lệnh xóa nhầm trên primary cũng được nhân bản ngay. Replica dùng khi máy primary hỏng, sao lưu dùng khi dữ liệu bị hỏng.

### Nâng replica lên primary (failover thủ công, chưa tự động)

```sh
docker compose exec mysql-replica sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "STOP REPLICA; RESET REPLICA ALL; SET PERSIST super_read_only = OFF; SET PERSIST read_only = OFF;"'
```

Sau đó đổi host trong `DATABASE_URL` của các service từ `mysql` sang `mysql-replica` rồi `docker compose up -d`. Các bước này đã ghi lại nhưng chưa được kiểm thử.

## Giới hạn và bước tiếp theo

- Bản sao lưu nằm cùng máy với MySQL. Khi triển khai thật cần đẩy `backups/` ra nơi khác, ví dụ dùng `rclone` hoặc `aws s3 sync` sau mỗi lượt.
- Chưa có incremental backup. Binlog đã bật cùng GTID, có thể dùng `mysqlbinlog --read-from-remote-server` để sao lưu liên tục và khôi phục tới một thời điểm.
- Failover sang replica đang làm thủ công. Muốn tự động cần thêm công cụ như MySQL Router/InnoDB Cluster hoặc Orchestrator.
