#!/bin/bash
# Nạp token rồi chạy bộ đẩy tình trạng máy. Cùng lối với `chay-bridge.sh`: token nằm ĐÚNG MỘT CHỖ
# (~/dahao-gateway/bridge-tokens.env, chmod 600) chứ không nhân bản vào plist — plist nằm trong thư
# mục ai cũng liệt kê được.
set -euo pipefail
APP="$HOME/dahao-gateway"
set -a; . "$APP/bridge-tokens.env"; set +a

# Bridge nghe trên địa chỉ Tailscale. Lúc máy vừa bật, giao diện Tailscale có thể chưa lên; hỏi vào
# lúc đó là hỏng liên tục, `KeepAlive` quay vòng chết. Chờ địa chỉ hiện ra rồi hẵng chạy.
DIA="100.107.219.95"
for i in $(seq 1 60); do
  ifconfig | grep -q "inet $DIA " && break
  [ "$i" = 60 ] && { echo "!! Địa chỉ $DIA không có trên máy sau 60s (Tailscale chưa lên?)." >&2; exit 1; }
  sleep 1
done

# `-u`: tắt đệm stdout. Không có nó, Python gom vài KB mới xả một lần — log đứng im hàng phút rồi
# nhảy một cục, đúng thứ ngược lại với "thời gian thực".
exec /usr/bin/python3 -B -u "$APP/quan-sat/dong-bo-tinh-trang.py"
