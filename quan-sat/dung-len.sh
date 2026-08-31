#!/bin/bash
# Dựng tầng quan sát. Chạy được nhiều lần, không hỏng gì nếu chạy lại.
#
#   bash ~/dahao-gateway/quan-sat/dung-len.sh
#
# Tắt đi:      cd ~/dahao-gateway/quan-sat && docker compose down
# Xoá sạch:    docker compose down -v      (mất luôn log đã gom)
set -euo pipefail
export PATH=/opt/homebrew/bin:$PATH
cd "$(dirname "$0")"

GATEWAY="$HOME/dahao-gateway"

echo "== 1/6  Kiểm tra Docker sống chưa"
if ! docker info >/dev/null 2>&1; then
  echo "!! Docker chưa chạy. Mở OrbStack trên màn hình Mini cho xong phần cài đặt lần đầu," >&2
  echo "   rồi chạy lại lệnh này. (Xem phần 'Khi OrbStack không chịu khởi động' trong README.md)" >&2
  exit 1
fi
docker version --format '   docker {{.Client.Version}} / engine {{.Server.Version}}'

echo
echo "== 2/6  Tạo .env nếu chưa có"
if [ -f .env ]; then
  echo "   .env đã có, giữ nguyên (không sinh lại mật khẩu)."
else
  # Mật khẩu admin Grafana sinh ngẫu nhiên và KHÔNG BAO GIỜ in ra màn hình.
  # Muốn lấy: cd ~/dahao-gateway/quan-sat && grep GRAFANA_MAT_KHAU .env | cut -d= -f2 | pbcopy
  MK="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 28)"
  umask 077
  cat > .env <<EOF
# Phiên bản ảnh Docker. Ghim để lần dựng sau ra đúng thứ đang chạy hôm nay.
LOKI_TAG=3.4.2
ALLOY_TAG=v1.7.5
GRAFANA_TAG=11.6.1

# Thư mục log trên máy chủ, Alloy gắn vào kiểu chỉ-đọc.
THU_MUC_GATEWAY=$GATEWAY

# Grafana CHỈ nghe trên địa chỉ tailnet. Đổi thành 0.0.0.0 là mở ra cả LAN xưởng.
DIA_CHI_TAILNET=100.107.219.95

# Xem thì không cần đăng nhập; mật khẩu này chỉ để SỬA bảng.
GRAFANA_MAT_KHAU=$MK
EOF
  chmod 600 .env
  echo "   đã tạo .env (chmod 600) — mật khẩu admin dài ${#MK} ký tự, không in ra đây."
fi

echo
echo "== 3/6  Kiểm tra thư mục log có thật không"
thieu=0
for f in broker.log logs bridge-data; do
  if [ -e "$GATEWAY/$f" ]; then
    echo "   có  $GATEWAY/$f"
  else
    echo "   THIẾU $GATEWAY/$f" >&2; thieu=1
  fi
done
[ "$thieu" -eq 0 ] || { echo "!! Thiếu nguồn log, dừng lại." >&2; exit 1; }

echo
echo "== 4/6  Kéo ảnh và dựng"
docker compose pull
docker compose up -d

echo
echo "== 5/6  Đợi Loki sẵn sàng (tối đa 120 giây)"
for i in $(seq 1 24); do
  sleep 5
  if curl -fsS http://127.0.0.1:3100/ready 2>/dev/null | grep -q ready; then
    echo "   Loki sẵn sàng sau $((i*5)) giây"
    break
  fi
  [ "$i" -eq 24 ] && { echo "!! Loki chưa sẵn sàng. docker compose logs loki" >&2; exit 1; }
done

echo
echo "== 6/6  Kiểm chứng: log CÓ THẬT chảy vào chưa"
# Đây là bước quan trọng nhất. Dựng xong mà không có dòng nào vào thì coi như chưa xong.
sleep 20
NHAN=$(curl -fsS 'http://127.0.0.1:3100/loki/api/v1/labels' 2>/dev/null || echo '')
echo "   nhãn Loki thấy được: $NHAN"

SO=$(curl -fsS --get 'http://127.0.0.1:3100/loki/api/v1/query' \
      --data-urlencode 'query=sum(count_over_time({job="broker"}[5m]))' 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d["data"]["result"]; print(r[0]["value"][1] if r else 0)' 2>/dev/null || echo 0)
echo "   dòng broker.log gom được trong 5 phút: $SO"

MAY=$(curl -fsS --get 'http://127.0.0.1:3100/loki/api/v1/label/may/values' 2>/dev/null \
    | python3 -c 'import json,sys; print(", ".join(json.load(sys.stdin).get("data") or []) or "(chưa có)")' 2>/dev/null || echo '(không đọc được)')
echo "   định danh máy Loki đã thấy: $MAY"

echo
if [ "${SO:-0}" != "0" ]; then
  echo "XONG. Mở Grafana:  http://100.107.219.95:3000"
  echo "      Bảng 'Tuyến Dahao — vận hành' nằm trong thư mục Dahao, xem không cần đăng nhập."
else
  echo "!! Dựng xong nhưng CHƯA có dòng log nào vào Loki."
  echo "   Xem vì sao:  docker compose logs alloy | tail -40"
  exit 1
fi
