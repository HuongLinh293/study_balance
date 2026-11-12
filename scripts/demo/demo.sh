#!/usr/bin/env bash
# Demo runner for the defense, one rubric chapter per step.
#   npm run demo                 all chapters in order, pausing between steps
#   npm run demo -- check        pre-flight check (run 30 minutes before)
#   npm run demo -- seed         create/reset the demo account
#   npm run demo -- ch2 … ch8    one chapter;  npm run demo -- reset  bring everything back up
# Each step prints what it does (▶), what to say (Nói:) and the commands it runs ($).
set -uo pipefail
cd "$(dirname "$0")/../.."

env_or() { local v; v=$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-); echo "${v:-$2}"; }
HTTPS_PORT=$(env_or GATEWAY_HTTPS_PORT 8443)
HTTP_PORT=$(env_or GATEWAY_PORT 8080)
GRAFANA_PORT=$(env_or GRAFANA_PORT 3030)
export DEMO_BASE_URL="https://localhost:$HTTPS_PORT"
export NODE_EXTRA_CA_CERTS=infrastructure/nginx/certs/tls.crt
CA=infrastructure/nginx/certs/tls.crt
APP="https://localhost:$HTTPS_PORT"

say()   { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
talk()  { printf '\033[0;33m  Nói: %s\033[0m\n' "$*"; }
open_() { printf '\033[0;35m  Mở: %s\033[0m\n' "$*"; }
run()   { printf '\033[2m$ %s\033[0m\n' "$*"; bash -c "$*"; }
pause() { if [ -t 0 ]; then read -r -p $'\033[2m  ⏎ tiếp tục…\033[0m' _; fi; }
pass()  { printf '  \033[32m✔\033[0m %s\n' "$*"; }
miss()  { printf '  \033[31m✖\033[0m %s\n' "$*"; FAILED=1; }
sql()   { docker compose exec -T mysql sh -c "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -N -e \"$1\"" 2>/dev/null; }
replica_sql() { docker compose exec -T mysql-replica sh -c "MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -N -e \"$1\"" 2>/dev/null; }
first_container() { docker compose ps --format '{{.Name}}' "$1" | sort | head -1; }
last_container()  { docker compose ps --format '{{.Name}}' "$1" | sort | tail -1; }
demo_user_id() { sql "SELECT id FROM user_db.users WHERE email = 'demo@studybalance.dev'"; }
alerts() {
  curl -s http://127.0.0.1:9090/api/v1/alerts | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const a = JSON.parse(s).data.alerts;
      console.log(a.length ? a.map((x) => `${x.labels.alertname} [${x.state}] ${x.annotations.summary}`).join("\n") : "không có cảnh báo");
    });'
}

check() {
  say "Kiểm tra trước demo"
  FAILED=0
  local healthy; healthy=$(docker compose ps --format '{{.Service}} {{.Status}}' | grep -E -- '-service' | grep -c '(healthy)')
  [ "$healthy" -ge 7 ] && pass "7 bản sao service healthy" || miss "chỉ $healthy/7 bản sao service healthy → npm run demo -- reset"
  for svc in mysql mysql-replica rabbitmq gateway prometheus grafana backup; do
    docker compose ps --status running --services | grep -qx "$svc" && pass "$svc đang chạy" || miss "$svc không chạy"
  done
  curl -s --cacert "$CA" -o /dev/null -w '%{http_code}' "$APP/api/user/health" | grep -q 200 && pass "HTTPS gateway $APP" || miss "gateway HTTPS không trả lời"
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:$HTTP_PORT/" | grep -q 308 && pass "HTTP :$HTTP_PORT chuyển hướng 308" || miss "HTTP không chuyển hướng"
  security verify-cert -c "$CA" >/dev/null 2>&1 && pass "macOS đã tin cậy chứng chỉ (trình duyệt không cảnh báo)" \
    || printf '  \033[33m!\033[0m trình duyệt sẽ cảnh báo chứng chỉ; tin cậy: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain %s\n' "$CA"
  [ "$(replica_sql "SELECT COUNT(*) FROM performance_schema.replication_applier_status WHERE SERVICE_STATE='ON'")" = 1 ] && pass "replica MySQL đang chép" || miss "replica chưa chạy → docker compose run --rm replica-setup"
  local down; down=$(curl -s http://127.0.0.1:9090/api/v1/targets | grep -o '"health":"down"' | wc -l | tr -d ' ')
  [ "$down" = 0 ] && pass "Prometheus: mọi target up" || miss "Prometheus: $down target down"
  curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$GRAFANA_PORT/api/health" | grep -q 200 && pass "Grafana http://localhost:$GRAFANA_PORT" || miss "Grafana không trả lời"
  curl -s -o /dev/null -w '%{http_code}' http://localhost:15672/ | grep -q 200 && pass "RabbitMQ Management http://localhost:15672" || miss "RabbitMQ Management không trả lời"
  node -e 'import("./scripts/demo/lib.mjs").then((m) => m.demoLogin()).then(() => console.log("  \x1b[32m✔\x1b[0m tài khoản demo đăng nhập được"), () => { console.log("  \x1b[31m✖\x1b[0m chưa có tài khoản demo → npm run demo -- seed"); process.exit(1); })' || FAILED=1
  ls backups 2>/dev/null | grep -qE '^[0-9]{8}T' && pass "có bản sao lưu: $(ls backups | grep -E '^[0-9]{8}T' | tail -1)" || miss "chưa có bản sao lưu → npm run backup:now"
  printf '  cảnh báo đang bật: %s\n' "$(alerts | tr '\n' ';')"
  [ "$FAILED" = 0 ] && printf '\n\033[1;32mSẵn sàng demo.\033[0m\n' || printf '\n\033[1;31mCòn mục chưa sẵn sàng (xem ✖ ở trên).\033[0m\n'
  return "$FAILED"
}

seed() {
  say "Tạo lại tài khoản demo"
  run "node scripts/demo/seed.mjs"
}

ch2() {
  say "Chương 2 — Kiến trúc: 5 microservice, mỗi service một database, giao tiếp qua sự kiện"
  talk "Mỗi service là một container riêng; task và planning chạy 2 bản sao sau Nginx."
  run "docker compose ps --format 'table {{.Service}}\t{{.Name}}\t{{.Status}}' | grep -E 'SERVICE|-service'"
  pause
  talk "Mỗi service có database và tài khoản MySQL riêng. task_app không đọc được database của user-service."
  run "docker compose exec -T mysql sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -t -e \"SELECT user AS tai_khoan, db AS duoc_phep FROM mysql.db WHERE db LIKE \\\"%\\\\_db\\\" ORDER BY db\"'"
  run "docker compose exec -T mysql sh -c 'MYSQL_PWD=local_task_change_me mysql -utask_app -e \"SELECT COUNT(*) FROM user_db.users\"' 2>&1 | tail -1"
  pause
  talk "Hướng sự kiện: mỗi consumer có queue riêng, chỉ đăng ký loại sự kiện nó cần (routing key)."
  run "docker compose exec -T rabbitmq rabbitmqctl list_bindings -q source_name destination_name routing_key 2>/dev/null | awk '\$1==\"studybalance.events\" {printf \"  %-30s ← %s\n\", \$2, \$3}' | sort"
  open_ "docs/architecture/01-tong-quan.png, 03-ban-do-su-kien.png"
}

ch3() {
  say "Chương 3 — Tiến trình và luồng: planner chạy trong worker_threads"
  talk "Thuật toán lập lịch tốn CPU (500 việc ≈ 1.1–1.6 s). Chạy trong worker thread nên event loop vẫn phục vụ request khác."
  open_ "Grafana http://localhost:$GRAFANA_PORT → panel 'Planner (worker threads)' và 'Event loop lag'"
  run "docker compose logs planning-service --no-log-prefix 2>/dev/null | grep planner_worker_started | tail -4"
  pause
  run "node scripts/demo/planner-load.mjs 300"
  pause
  talk "Tác vụ định kỳ: outbox relay 500 ms, nhắc việc mỗi phút, đồng bộ Google, sao lưu mỗi ngày. Tiến trình do Docker quản lý: restart + healthcheck + tắt êm."
  open_ "docs/processes-threads.md"
}

ch4() {
  say "Chương 4 — Trao đổi thông tin: REST, RabbitMQ, thời gian thực (SSE)"
  open_ "$APP bằng tài khoản demo@studybalance.dev / StudyBalance2026 (2 cửa sổ cạnh nhau)"
  talk "Một thao tác REST sinh sự kiện; correlationId đi theo request và sự kiện qua mọi service."
  run "node scripts/demo/trace.mjs"
  pause
  talk "Thời gian thực: notification-service đẩy sự kiện qua SSE. Quan sát chuông thông báo trên giao diện đổi ngay."
  run "node scripts/demo/sse-watch.mjs 12"
  open_ "RabbitMQ Management http://localhost:15672 → Queues (số tin, retry, dlq)"
}

ch5() {
  say "Chương 5 — Định danh: UUID, JWT, DNS, TLS"
  talk "Mọi thực thể và sự kiện dùng UUID; client tự sinh id nên gửi lại không tạo bản trùng."
  run "docker compose exec -T mysql sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -t -e \"SELECT event_type, event_id, JSON_UNQUOTE(JSON_EXTRACT(body, \\\"\$.correlationId\\\")) AS correlation_id FROM task_db.outbox ORDER BY id DESC LIMIT 3\"'"
  pause
  talk "JWT: sub là userId (UUID), có iss/aud/exp 15 phút. Mỗi service tự kiểm tra chữ ký; sửa một ký tự là bị từ chối."
  run "node scripts/demo/jwt.mjs"
  pause
  talk "DNS: Nginx và Prometheus tìm bản sao qua DNS của Docker; tên task-service trả về 2 địa chỉ."
  run "docker compose exec -T gateway nslookup task-service 127.0.0.11 2>/dev/null | grep -A1 '^Name' | grep Address"
  talk "TLS: chỉ TLS 1.2/1.3, HTTP/2; HTTP chuyển hướng 308; cookie refresh HttpOnly, Secure, SameSite=Strict."
  run "openssl x509 -in $CA -noout -subject -enddate; openssl x509 -in $CA -noout -text | grep -A1 'Subject Alternative' | tail -1"
  run "docker run --rm --network studybalance_default --entrypoint sh mysql:8.4 -c 'for v in tls1_1 tls1_2 tls1_3; do printf \"  %s: \" \$v; echo | openssl s_client -connect gateway:443 -servername localhost -\$v 2>/dev/null | grep -E \"^New,\" | grep -v NONE || echo \"bị từ chối\"; done'"
  run "curl -s -o /dev/null -w '  http://localhost:$HTTP_PORT/ → %{http_code} %{redirect_url}\n' http://localhost:$HTTP_PORT/"
}

ch6() {
  say "Chương 6 — Đồng bộ hóa: khóa lạc quan, inbox, xem trước có kiểm tra"
  talk "Khóa lạc quan bằng version; RabbitMQ giao lại không làm tính hai lần; bản xem trước đã cũ bị từ chối."
  run "node scripts/demo/consistency.mjs"
  sleep 1
  talk "Log của analytics: lần 1 xử lý, lần 2 bị inbox bỏ qua."
  run "node scripts/demo/logs.mjs demo-dup analytics-service | tail -2"
  talk "Khóa phân tán: outbox relay dùng SELECT … FOR UPDATE SKIP LOCKED (2 bản sao không phát trùng); migration và đồng bộ Google dùng GET_LOCK."
  open_ "docs/architecture/04-outbox-inbox.png, 05-mo-phong.png"
}

ch7() {
  say "Chương 7 — Sao lưu và phục hồi"
  talk "Container backup chạy mysqldump --single-transaction cho 5 database theo lịch, kèm SHA-256, giữ 7 bản."
  run "npm run -s backup:now 2>/dev/null | tail -1"
  local round; round=$(ls backups | grep -E '^[0-9]{8}T' | tail -1)
  run "ls -lh backups/$round | awk 'NR>1 {print \"  \"\$5\"  \"\$9}'"
  pause
  talk "Replication: mysql-replica nhận binlog qua GTID, chỉ cho đọc."
  run "npm run -s replica:status | grep -E 'IO_Running|SQL_Running:|Behind'"
  local uid; uid=$(demo_user_id)
  printf '  Số công việc của tài khoản demo — primary: %s, replica: %s\n' \
    "$(sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")" "$(replica_sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")"
  talk "Replica chỉ cho đọc: kể cả root cũng không ghi được."
  run "docker compose exec -T mysql-replica sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -e \"CREATE TABLE task_db.thu_ghi (id INT)\"' 2>&1 | tail -1"
  pause
  talk "Sự cố: xóa nhầm toàn bộ công việc của tài khoản demo trên primary. Replica cũng mất theo — vì vậy vẫn cần sao lưu."
  run "docker compose exec -T mysql sh -c 'MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mysql -uroot -e \"DELETE FROM task_db.tasks WHERE user_id=\\\"$uid\\\"\"'"
  sleep 1
  printf '  Sau sự cố — primary: %s, replica: %s công việc\n' \
    "$(sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")" "$(replica_sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")"
  open_ "Tải lại giao diện: danh sách công việc trống"
  pause
  talk "Khôi phục cả lượt sao lưu: kiểm tra checksum, dừng service, nạp lại, bật lại."
  run "bash scripts/restore-db.sh --yes $round"
  printf '  Sau khôi phục — primary: %s, replica: %s công việc\n' \
    "$(sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")" "$(replica_sql "SELECT COUNT(*) FROM task_db.tasks WHERE user_id='$uid'")"
  open_ "Tải lại giao diện (đăng nhập lại nếu cần): công việc đã trở lại"
}

ch8() {
  say "Chương 8 — Tính chịu lỗi"
  open_ "Prometheus http://localhost:9090/alerts và Grafana http://localhost:$GRAFANA_PORT"
  talk "Cân bằng tải: Nginx chia request cho 2 bản sao (header X-Served-By)."
  run "for i in \$(seq 1 10); do curl -s --cacert $CA -D - -o /dev/null $APP/api/task/health | grep -i x-served-by; done | sort | uniq -c"
  pause
  local victim; victim=$(first_container task-service)
  talk "Failover: dừng hẳn $victim — người dùng không thấy lỗi, Prometheus báo thiếu bản sao."
  run "docker stop $victim >/dev/null && echo '  đã dừng $victim'"
  run "for i in \$(seq 1 20); do curl -s --cacert $CA -o /dev/null -w '%{http_code}\n' $APP/api/task/health; done | sort | uniq -c | sed 's/^/  /'"
  printf '  Chờ cảnh báo (≈ 30–60 s)'
  for _ in $(seq 1 30); do alerts | grep -q 'ReplicasBelowDesired \[firing\]' && break; printf '.'; sleep 3; done; echo
  alerts | sed 's/^/  /'
  run "docker start $victim >/dev/null && echo '  đã bật lại $victim'"
  pause
  local crash; crash=$(last_container planning-service)
  talk "Crash: tiến trình trong $crash tự thoát → Docker khởi động lại (restart: unless-stopped)."
  local before; before=$(docker inspect -f '{{.RestartCount}}' "$crash")
  run "docker exec $crash kill -TERM 1"
  for _ in $(seq 1 40); do [ "$(docker inspect -f '{{.RestartCount}}' "$crash")" -gt "$before" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$crash")" = healthy ] && break; sleep 2; done
  printf '  RestartCount %s → %s, trạng thái %s\n' "$before" "$(docker inspect -f '{{.RestartCount}}' "$crash")" "$(docker inspect -f '{{.State.Health.Status}}' "$crash")"
  pause
  talk "RabbitMQ sập: ghi vẫn thành công nhờ outbox, planning báo TASK_NOT_SYNCED; broker bật lại thì phát bù. Xem panel Outbox trên Grafana."
  run "npm run -s test:outage"
  pause
  talk "Circuit breaker: user-service gọi planning/task/Google qua breaker — 5 lỗi liên tiếp thì mở mạch, 30 s sau thử lại 1 lần."
  run "npm test -s -w @studybalance/service-kit 2>&1 | grep -E '^✔|^✖|ℹ (pass|fail)'"
  open_ "docs/architecture/07-chiu-loi.png, 08-circuit-breaker.png"
}

reset() {
  say "Đưa mọi container về trạng thái chạy"
  run "docker compose up -d 2>&1 | grep -iE 'error' || true"
  for _ in $(seq 1 40); do [ "$(docker compose ps --format '{{.Service}} {{.Status}}' | grep -E -- '-service' | grep -c '(healthy)')" -ge 7 ] && break; sleep 3; done
  check
}

case "${1:-all}" in
  check|seed|ch2|ch3|ch4|ch5|ch6|ch7|ch8|reset) "$1" ;;
  all) check && for c in ch2 ch3 ch4 ch5 ch6 ch7 ch8; do "$c"; pause; done ;;
  *) echo "Dùng: npm run demo -- [check|seed|ch2|ch3|ch4|ch5|ch6|ch7|ch8|reset|all]"; exit 2 ;;
esac
