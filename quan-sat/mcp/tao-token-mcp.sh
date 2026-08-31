#!/bin/zsh
# Tạo tài khoản dịch vụ + token CHỈ ĐỌC cho mcp-grafana.
# Token KHÔNG in ra màn hình — ghi thẳng vào tệp chmod 600 rồi chỉ báo dấu vân tay.
set -eu
QS=/Users/phong/dahao-gateway/quan-sat
GF=http://100.107.219.95:3000
DICH=$QS/mcp-grafana.env

set -a; . $QS/grafana-admin.env; set +a
AUTH="$GF_SECURITY_ADMIN_USER:$GF_SECURITY_ADMIN_PASSWORD"

# 1) Tài khoản dịch vụ — dùng lại nếu đã có
ID=$(curl -sS -u "$AUTH" "$GF/api/serviceaccounts/search?query=claude-mcp" \
     | /usr/bin/python3 -B -c 'import json,sys; d=json.load(sys.stdin); s=[x for x in d.get("serviceAccounts",[]) if x["name"]=="claude-mcp"]; print(s[0]["id"] if s else "")')

if [ -z "$ID" ]; then
  ID=$(curl -sS -u "$AUTH" -X POST "$GF/api/serviceaccounts" \
       -H 'Content-Type: application/json' \
       -d '{"name":"claude-mcp","role":"Viewer","isDisabled":false}' \
       | /usr/bin/python3 -B -c 'import json,sys; print(json.load(sys.stdin).get("id",""))')
  echo "da tao tai khoan dich vu claude-mcp (Viewer), id=$ID"
else
  echo "dung lai tai khoan dich vu claude-mcp co san, id=$ID"
fi
[ -n "$ID" ] || { echo "!! khong lay duoc id"; exit 1; }

# 2) Token — Grafana chỉ trả giá trị đúng MỘT lần, nên tạo mới mỗi lượt chạy
TEN="claude-mcp-$(/bin/date +%Y%m%d-%H%M%S)"
KQ=$(curl -sS -u "$AUTH" -X POST "$GF/api/serviceaccounts/$ID/tokens" \
     -H 'Content-Type: application/json' -d "{\"name\":\"$TEN\"}")

umask 077
export DICH
printf '%s' "$KQ" | /usr/bin/python3 -B -c '
import hashlib, json, os, sys
d = json.load(sys.stdin)
k = d.get("key")
if not k:
    sys.exit("!! Grafana khong tra token: " + json.dumps(d)[:200])
p = os.environ["DICH"]
with open(p, "w") as f:
    f.write("GRAFANA_URL=https://grafana.phonh.io.vn\n")
    f.write("GRAFANA_SERVICE_ACCOUNT_TOKEN=%s\n" % k)
os.chmod(p, 0o600)
print("da ghi %s (chmod 600)" % p)
print("do dai token: %d ky tu | dau van tay sha256: %s" % (len(k), hashlib.sha256(k.encode()).hexdigest()[:16]))
'
