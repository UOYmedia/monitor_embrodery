#!/bin/sh
# Dong goi dahao-gateway.tar.gz — goi cai len Mac Mini.
#
# VI SAO CO FILE NAY: truoc day goi duoc go bang tay bang `tar czf`. Da lac hau THAT hai
# lan: 22/08 broker.py trong goi la 13.977 byte trong khi tren dia la 36.502 (goi khong he
# chua enumerator); 25/08 goi thieu bridge/lib/downtime.mjs va broker.py cu 2.675 byte.
# Ca hai lan, "cai lai tu goi" = lang le lui ve ban cu ma khong ai bao gi.
# scripts/deploy-mini-sync.test.mjs canh viec do, script nay la cach SUA no.
#
# Chay:  sh deploy-mini/dong_goi.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
DICH="$HERE/dahao-gateway.tar.gz"

TAM=$(mktemp -d)
trap "rm -rf $TAM" EXIT
G="$TAM/deploy-mini"
mkdir -p "$G"

# bridge/ lay tu BAN GOC cua repo, khong lay tu deploy-mini/bridge/ — de goi khong bao gio
# thua huong cai lech cua cay staging.
rsync -a --delete "$REPO/bridge/" "$G/bridge/"

# ws la phu thuoc runtime duy nhat cua bridge.
mkdir -p "$G/node_modules"
rsync -a "$REPO/node_modules/ws/" "$G/node_modules/ws/"

# Cong cu + cau hinh van hanh.
for f in broker.py install.sh README.txt \
         fleet-store.dahao-mqtt.json bridge.config.dahao-mqtt.json \
         do_on_dinh.py xoay_log_he_thong.py com.dahao.xoaylog.plist; do
  cp "$HERE/$f" "$G/$f"
done
rsync -a "$HERE/cloudflare/" "$G/cloudflare/"
rsync -a "$HERE/tests/"      "$G/tests/"
[ -d "$HERE/docs" ] && rsync -a "$HERE/docs/" "$G/docs/"

# KHONG bao gio dong goi: giao dien (day la dich vu thuan API), du lieu chay that,
# va chinh cac ban goi cu.
rm -rf "$G/dist" "$G/index.html"
rm -f  "$G"/*.tar.gz "$G/broker.log" "$G/catalog.json" "$G/enum-growth.csv"

tar czf "$DICH" -C "$TAM" deploy-mini
echo "==> $DICH  ($(wc -c < "$DICH" | tr -d " ") byte, $(tar tzf "$DICH" | wc -l | tr -d " ") muc)"
