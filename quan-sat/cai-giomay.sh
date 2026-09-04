#!/bin/bash
# Cài LaunchDaemon cho bộ đếm giờ máy. Báo rõ từng bước — chuỗi lệnh một dòng trước đó
# hỏng ở đâu không ai biết, vì `&&` gãy là im luôn.
#
#   sudo ~/dashboarddahao/quan-sat/cai-giomay.sh
#
# Phải là LaunchDaemon (không phải LaunchAgent): agent chỉ chạy khi có người đăng nhập,
# đã mù mất 7h44 hôm 28/08 vì chuyện đó.
set -u
NHAN=com.dahao.giomay
NGUON=/Users/phong/dashboarddahao/quan-sat/launchd/$NHAN.plist
DICH=/Library/LaunchDaemons/$NHAN.plist

buoc() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
xong() { printf '   ✅ %s\n' "$*"; }
hong() { printf '   ❌ %s\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || hong "phải chạy bằng sudo"

buoc "1/6  kiểm file nguồn"
[ -f "$NGUON" ] || hong "không thấy $NGUON"
plutil -lint "$NGUON" >/dev/null || hong "plist sai cú pháp"
xong "$NGUON ($(wc -c <"$NGUON" | tr -d ' ') byte, cú pháp đạt)"

buoc "2/6  kiểm đường chạy khai trong plist"
# Đừng lấy cứng chỉ số: plist là `python3 -B -u <file>`, cờ nhiều hay ít là đổi vị trí ngay.
# Lấy đối số ĐẦU làm chương trình, đối số cuối kết thúc `.py` làm tệp.
DS=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$NGUON" 2>/dev/null \
     | sed -n 's/^ *\(\/[^ ].*\)$/\1/p; s/^ *\(-[^ ]*\)$/\1/p')
CT=$(printf '%s\n' "$DS" | head -1)
TEP=$(printf '%s\n' "$DS" | grep '\.py$' | tail -1)
[ -n "$CT" ]  || hong "plist không khai ProgramArguments"
[ -x "$CT" ]  || hong "không chạy được $CT"
[ -n "$TEP" ] || hong "plist không khai tệp .py nào"
[ -f "$TEP" ] || hong "không thấy $TEP"
xong "$CT ... $TEP"

buoc "3/6  gỡ bản đang chạy (nếu có)"
launchctl bootout "system/$NHAN" 2>/dev/null && xong "đã gỡ daemon cũ" || xong "chưa có daemon nào, bỏ qua"
if pgrep -f dem-gio-may.py >/dev/null; then
    pkill -f dem-gio-may.py && xong "đã giết tiến trình nohup cũ"
    sleep 1
else
    xong "không có tiến trình nohup nào"
fi

buoc "4/6  chép và đặt quyền"
cp "$NGUON" "$DICH"      || hong "cp hỏng"
chown root:wheel "$DICH" || hong "chown hỏng"
chmod 644 "$DICH"        || hong "chmod hỏng"
xong "$(ls -l "$DICH")"

buoc "5/6  nạp"
launchctl bootstrap system "$DICH" || hong "bootstrap hỏng — xem lỗi ngay trên"
xong "đã bootstrap"

buoc "6/6  kiểm lại sau 5 giây"
sleep 5
launchctl print "system/$NHAN" 2>/dev/null \
    | grep -E '^[[:space:]]*(state|pid|last exit code|program) ' | sed 's/^/   /'
PID=$(pgrep -f dem-gio-may.py | head -1)
[ -n "$PID" ] || hong "tiến trình không lên — xem logs/gio-may.err"
xong "đang chạy, PID $PID"
printf '\n   Thử lại lần cuối: khởi động lại Mini rồi chạy\n     pgrep -f dem-gio-may.py\n'
