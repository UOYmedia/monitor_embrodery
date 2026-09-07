# Plan 001: A15 autonomous‑telemetry enumerator — a complete catalog of every field the embroidery machine emits with no operator at the machine

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4a76958..HEAD -- deploy-mini/broker.py`
> If `deploy-mini/broker.py` changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (Phase A, code + offline self‑test) / MED (Phase B, live deploy to the production broker)
- **Depends on**: none
- **Category**: direction / dx (instrumentation + protocol discovery)
- **Planned at**: commit `4a76958`, 2026-08-21

## Why this matters

The goal is a definitive answer to "what information can this closed Dahao
BECS‑A15 embroidery machine give us **without anyone touching the machine's
control panel (HMI)**?" The machine talks a proprietary MQTT dialect ("emCAD",
TCP port 3865) to a broker we run (`deploy-mini/broker.py`). Today that broker
decodes only **four** fields out of each live `state` message
(`curStitch`, `patternStitch`, `state`, `patternName`) and throws the rest of
the JSON away. Nobody has enumerated the *full* set of keys the machine emits,
nor confirmed whether any richer data can be pulled from it server‑side.

A crucial protocol fact (established during recon, see "Current state") bounds
the answer and must shape the whole approach: **the emCAD protocol has no
server‑initiated query topic.** Every server→machine topic is a *reply/ack* to
something the machine started (auth, pattern browse/query/download, upload,
userLogin). Under the hard "no operator" constraint, the machine's information
surface is therefore exactly what it emits **autonomously**: the connection
handshake (identity), the periodic `state` heartbeat (the rich telemetry), and
disconnect events. This plan builds an **enumerator** that captures that surface
exhaustively and produces two artifacts: a machine‑readable `catalog.json`
(every distinct topic + JSON key‑path the machine ever sent, with type, example,
numeric range, and which machine states it appeared in) and a human‑readable
`enum.log` coverage report. It also runs a small, safe **falsification probe**
to empirically confirm the "no server pull" conclusion rather than merely
asserting it. The catalog *is* the deliverable the user asked for.

## Current state

The gateway is one self‑contained Python MQTT broker. **The repo copy you edit
is `deploy-mini/broker.py`**; it is later mirrored to a Mac Mini (host that runs
24/7) at `~/dahao-gateway/broker.py` and launched by a macOS `launchd` agent
`com.dahao.broker`. The live machine (device id `602602704E7B`) is already
connected to that broker and streams `state` on its own — **no operator action
is needed for the machine to emit `state`.**

Key facts, inlined (you have not seen the rest of the project):

- `deploy-mini/broker.py` — the whole broker. ~509 lines. Pure Python + one
  dependency, `pycryptodome` (already installed locally and on the Mini).
  - Constants (`deploy-mini/broker.py:7-13`):
    ```python
    HOST='0.0.0.0'; PORT=3865
    KEY=b'...'; IV=b'...'          # 16‑byte AES‑128‑CBC key/iv, do NOT reproduce these values anywhere
    A=[...]; B=[...]              # XXTEA auth constants
    LOG=os.path.join(os.path.dirname(__file__),'broker.log')
    STATE=os.path.join(os.path.dirname(__file__),'state.log')
    lock=threading.Lock()
    clients=[]  # entries are [sock, subs:set, {'dev':<str|None>}]
    ```
  - Crypto/util helpers already present — **reuse, do not reimplement**:
    - `dec_json(payload)` (`:41`) — takes the raw MQTT payload bytes (base64 of
      AES‑CBC ciphertext), returns the decoded JSON `dict` (`{"header":{...},
      "body":{...}}`). Raises on non‑decodable payloads.
    - `aes_enc_json(obj)` (`:48`) — inverse; returns base64 `str`.
    - `deliver(topic, payload_bytes)` (`:92`) — publishes to every connected
      client subscribed to `topic`; returns the number of recipients.
    - `prettytxt(payload)` — returns a short printable form of a payload
      (used when logging undecodable bytes).
    - `log(*a)` (`:15`) — appends to `broker.log` and prints to stdout.
  - Inbound dispatch, inside `client_thread` (`deploy-mini/broker.py:439-463`).
    This is the single place every machine→server PUBLISH is routed:
    ```python
            elif typ==3:  # PUBLISH
                qos=(flags>>1)&3
                topic,i=rd_str(body,0)
                pid=None
                if qos>0:
                    pid=struct.unpack_from('>H',body,i)[0]; i+=2
                payload=body[i:]
                t=topic.decode(errors='replace')
                if 'auth/login' in t:
                    ...
                    handle_auth_login(entry,t,payload)
                elif 'auth/encode' in t:
                    handle_auth_encode(t,payload)
                elif '/state' in t or 'state' in t.split('/'):
                    dev2=t.rsplit('/',1)[-1]
                    with open(STATE,'a') as f: f.write('%s %s\n'%(t,prettytxt(payload)))
                    try:
                        b=dec_json(payload).get('body',{})
                        log('*** STATE dev=%s cur=%s tot=%s state=%s pat=%s'%(dev2,b.get('curStitch'),b.get('patternStitch'),b.get('state'),b.get('patternName')))
                        forward_to_bridge(dev2,b)
                    except Exception as e:
                        log('*** STATE parse lỗi: %s'%e)
                elif 'pattern/data/ack' in t:
                    handle_pattern_dataack(entry,t,payload)
                elif 'pattern/browse' in t:
                    handle_pattern_browse(entry,t,payload)
                elif 'pattern/query' in t and 'query/ack' not in t:
                    handle_pattern_query(entry,t,payload)
                elif 'pattern/download' in t:
                    handle_pattern_download(entry,t,payload)
                elif 'pattern' in t:
                    ...  # decode+log catch‑all
                else:
                    log('PUBLISH %s  len=%d  %s'%(t,len(payload),prettytxt(payload)[:120]))
    ```
  - CONNECT handler (`deploy-mini/broker.py`, ~`:420-433`) already parses the
    MQTT CONNECT and captures the device id from the clientId into
    `entry[2]['dev']`:
    ```python
            if typ==1:  # CONNECT
                pn,i=rd_str(body,0); level=body[i]; cflags=body[i+1]
                ka=struct.unpack_from('>H',body,i+2)[0]; i+=4
                cid,i=rd_str(body,i)
                log('CONNECT proto=%s lvl=%d cid=%s keepalive=%d ...'%(...))
                _m=_re.match(r'([0-9A-Fa-f]{12})',cid.decode(errors='replace'))
                if _m: entry[2]['dev']=_m.group(1); log('  [dev] = %s (từ clientId)'%_m.group(1))
                sock.sendall(bytes([0x20,0x02,0x00,0x00]))  # CONNACK ok
    ```
  - `forward_to_bridge(dev, body)` (`:197`) and its helpers `build_frame` /
    `state_to_status` (`:181-196`) translate a decoded state body into the
    dashboard's contract and push it to `127.0.0.1:1600`. **This is the live
    production path feeding the user's dashboard — do not change its behavior.**
  - A control‑file thread already exists: `ctrl_watcher()` reads one command
    per write from `~/dahao-gateway/push-cmd.txt` (`browse` / `query <code>` /
    `data <code>`) and calls `do_ctrl(cmd)`. `main()` (`:496`) starts it with
    `threading.Thread(target=ctrl_watcher,daemon=True).start()`. Reuse this same
    pattern for the enumerator's writer thread and probe command.
  - `import re as _re` is already imported (mid‑file, above the pattern
    handlers). `json`, `base64`, `os`, `time`, `threading`, `struct`, `socket`
    are imported at the top (`:4`).

- **Complete emCAD topic universe** (extracted from the vendor binary
  `DesignServer.exe` during recon — this is the authoritative list; you do NOT
  have the binary, so treat this list as ground truth):
  - Machine → server (machine PUBLISHES): `auth/login`, `auth/encode`,
    `event/disconnect`, `pattern/browse` (and `emCAD/fromA15/v1/pattern/browse`),
    `pattern/data/ack`, `pattern/download`, `pattern/query`, `pattern/upload`,
    **`state`**, `toServer/hdd/pattern/send`, `toServer/pattern/send`,
    `userLogin`.
  - Server → machine (server PUBLISHES; all are replies/acks): `auth/confirm`,
    `auth/secret`, `event/disconnect`, `pattern/browse/reply` (and
    `emCAD/toA15/v1/pattern/browse/reply`), `pattern/data`, `pattern/query/ack`,
    `pattern/upload/ack`, `toEmCAD/hdd/pattern/send/ack`,
    `toEmCAD/pattern/send/ack`, `userLogin/reply`, `server/toemCAD/v1/state`.
  - **There is no server‑initiated request/query topic.** Of the machine→server
    topics, only `state` (+ the connect/auth handshake and `event/disconnect`)
    is emitted *without an operator*. `pattern/browse|query|download|upload` and
    the `toServer/*/pattern/send` topics all require an operator to open a screen
    on the HMI and are therefore **out of scope** for this plan.

- Partially‑known `state` body keys (already observed live, but the full set is
  unknown — that is exactly what the catalog must discover): `curStitch`,
  `patternStitch`, `state`, `patternName`, `machineName`, `machineModel`,
  `stateID`, `wstrStatusDesc`, `Speed`, `totalNum`, `patternNetID`, and a
  `header` object carrying `companyId`/`userId`. Some fields are expected to
  appear only in particular machine states (e.g. a needle number on a
  thread‑break, an error code in an error state) — capturing the **union across
  states over a long window** is the point.

- There is no test framework in this project for the broker; it is a standalone
  script. Verification is: `python3 -m py_compile`, a standalone self‑test
  script that feeds synthetic encrypted messages through the code (an existing
  example lives at
  `/private/tmp/.../scratchpad/test_push.py` and is referenced conceptually
  below — you will write a fresh one, you do not need that file), and a live
  smoke check on the Mini.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 4a76958..HEAD -- deploy-mini/broker.py` | empty, or you reconcile excerpts |
| Byte‑compile | `python3 -m py_compile deploy-mini/broker.py` | exit 0, no output |
| Crypto dep present | `python3 -c "from Crypto.Cipher import AES; print('ok')"` | prints `ok` |
| Offline self‑test | `python3 deploy-mini/tests/test_enumerator.py` | prints `== ENUM SELF-TEST PASS ==`, exit 0 |
| Enumerator import‑safe | `python3 -c "import importlib.util,sys; sys.argv=['x']; spec=importlib.util.spec_from_file_location('b','deploy-mini/broker.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('import ok')"` | prints `import ok` (module defines functions without starting the server; `main()` only runs under `__main__`) |

There is **no** package manager, build, lint, or typecheck step in this repo —
do not invent one. `pycryptodome` is already installed; do not run `pip install`.

## Suggested executor toolkit

- No project skills apply. Standard Python 3.9+ only (the Mini runs system
  `python3` 3.9; **do not use syntax newer than 3.9** — no `match`, no `|` union
  types in annotations at runtime).

## Scope

**In scope** (the only files you may create or modify):
- `deploy-mini/broker.py` — add the enumerator module + hook calls + start the
  writer thread in `main()` + add one probe command to `do_ctrl`. **Additive
  only.**
- `deploy-mini/tests/test_enumerator.py` — new offline self‑test (create the
  `tests/` directory).

**Out of scope** (do NOT touch, even though they look related):
- `forward_to_bridge`, `build_frame`, `state_to_status` and the `state`
  branch's existing forward call — this is the live dashboard feed. You may add
  an enumerator call *alongside* it, but must not alter what it forwards.
- The auth handlers (`handle_auth_login`, `handle_auth_encode`) and the XXTEA /
  AES helpers — reuse them, never modify.
- The pattern push handlers (`handle_pattern_*`, `_reply`, `_send_browse`) — the
  machine‑driven pull path; unrelated to this plan.
- `deploy-mini/bridge/`, `deploy-mini/dist/`, `deploy-mini/install.sh`, the
  `bridge.config.*.json`, and everything under the repo root outside
  `deploy-mini/` and `plans/`.
- The KEY/IV/A/B constant *values* — never print, log, or copy them anywhere.

## Git workflow

- Branch: `advisor/001-a15-telemetry-enumerator`.
- Commit per logical step. The repo's log is in Vietnamese, imperative mood
  (e.g. `git log --oneline -3` shows `Hiện các địa chỉ đang gọi vào bridge…`);
  short imperative subjects are fine in English or Vietnamese.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1 — Add the enumerator data structures and helpers (no hooks yet)

In `deploy-mini/broker.py`, **after** the pattern‑handler block and **before**
`def main():`, add a self‑contained enumerator section. It must not run any
network code at import time. Target shape:

```python
# ===== ENUMERATOR: catalog mọi thông tin máy TỰ PHÁT (không cần người ở máy) =====
ENUM_ON   = os.environ.get('ENUM_ENABLE','1') != '0'
CATALOG   = os.path.join(os.path.dirname(__file__),'catalog.json')
ENUM_LOG  = os.path.join(os.path.dirname(__file__),'enum.log')
_enum_lock = threading.Lock()
# Vì không có Date.now-cần-thiết ở đây, dùng time.time() bình thường (đây là script chạy thẳng).
_enum = {'startedAt': None, 'topics': {}, 'fields': {}, 'states': {}, 'connect': {}}

def _typename(v):
    if isinstance(v, bool): return 'bool'
    if isinstance(v, int): return 'int'
    if isinstance(v, float): return 'float'
    if isinstance(v, str): return 'str'
    if isinstance(v, list): return 'list'
    if isinstance(v, dict): return 'dict'
    if v is None: return 'null'
    return type(v).__name__

def _flatten(prefix, obj, out):
    # JSON lồng -> {"a.b.c": value}. List: ghi nhận độ dài + mẫu phần tử đầu.
    if isinstance(obj, dict):
        for k, v in obj.items():
            _flatten((prefix + '.' + str(k)) if prefix else str(k), v, out)
    elif isinstance(obj, list):
        out[prefix + '[]len'] = len(obj)
        if obj:
            _flatten(prefix + '[]', obj[0], out)
    else:
        out[prefix] = obj

def _state_key(body):
    # Nhãn trạng thái để gắn field vào: ưu tiên chuỗi mô tả, ngã về số.
    if not isinstance(body, dict): return 'n/a'
    for k in ('wstrStatusDesc', 'stateID', 'state'):
        if k in body and body[k] is not None:
            return '%s=%s' % (k, body[k])
    return 'n/a'

def catalog_observe(direction, topic, decoded, raw_len):
    """direction: 'in' (máy->server) | 'out' (server->máy). decoded: dict|None."""
    if not ENUM_ON: return
    with _enum_lock:
        if _enum['startedAt'] is None:
            _enum['startedAt'] = _iso()          # _iso() đã có sẵn trong file
        te = _enum['topics'].setdefault(topic, {'dir': direction, 'count': 0,
                                                 'firstSeen': _iso(), 'lastSeen': None,
                                                 'decodable': decoded is not None,
                                                 'minLen': raw_len, 'maxLen': raw_len})
        te['count'] += 1; te['lastSeen'] = _iso()
        te['minLen'] = min(te['minLen'], raw_len); te['maxLen'] = max(te['maxLen'], raw_len)
        if decoded is None: return
        body = decoded.get('body', decoded) if isinstance(decoded, dict) else {}
        skey = _state_key(body)
        if topic.endswith('state') or '/state' in topic:
            _enum['states'].setdefault(skey, {'count': 0, 'keys': []})
            _enum['states'][skey]['count'] += 1
        flat = {}
        _flatten('', decoded if isinstance(decoded, dict) else {'value': decoded}, flat)
        for kp, val in flat.items():
            fe = _enum['fields'].setdefault(kp, {'types': [], 'example': None,
                                                 'count': 0, 'states': [],
                                                 'numMin': None, 'numMax': None})
            fe['count'] += 1
            tn = _typename(val)
            if tn not in fe['types']: fe['types'].append(tn)
            if fe['example'] is None and not isinstance(val, (dict, list)):
                fe['example'] = val
            if skey not in fe['states']: fe['states'].append(skey)
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                fe['numMin'] = val if fe['numMin'] is None else min(fe['numMin'], val)
                fe['numMax'] = val if fe['numMax'] is None else max(fe['numMax'], val)
            if topic.endswith('state') or '/state' in topic:
                su = _enum['states'][skey]['keys']
                if kp not in su: su.append(kp)

def catalog_dump():
    with _enum_lock:
        snap = json.loads(json.dumps(_enum))   # bản sao an toàn
    try:
        with open(CATALOG, 'w') as f: json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
    except Exception as e:
        log('  [ENUM] ghi catalog lỗi: %s' % e)
    return snap

def catalog_report():
    snap = catalog_dump()
    lines = ['=== ENUM REPORT %s (bắt đầu %s) ===' % (_iso(), snap.get('startedAt'))]
    lines.append('Topic máy đã gửi/nhận: %d' % len(snap['topics']))
    for t, te in sorted(snap['topics'].items()):
        lines.append('  %-52s dir=%s n=%d len=%d..%d decodable=%s'
                     % (t, te['dir'], te['count'], te['minLen'], te['maxLen'], te['decodable']))
    lines.append('Trạng thái máy đã thấy: %d' % len(snap['states']))
    for s, se in sorted(snap['states'].items()):
        lines.append('  %-24s n=%d  #field=%d' % (s, se['count'], len(se['keys'])))
    lines.append('Tổng số field riêng biệt: %d' % len(snap['fields']))
    txt = '\n'.join(lines) + '\n'
    try:
        with open(ENUM_LOG, 'w') as f: f.write(txt)
    except Exception as e:
        log('  [ENUM] ghi enum.log lỗi: %s' % e)
    log('  [ENUM] report: %d topic, %d state, %d field'
        % (len(snap['topics']), len(snap['states']), len(snap['fields'])))

def catalog_writer():
    while True:
        try: catalog_report()
        except Exception as e: log('  [ENUM] writer lỗi: %s' % e)
        time.sleep(30)
```

Notes for the implementer:
- `_iso()` already exists in the file (used by `forward_to_bridge`); reuse it.
  Do **not** call `Date`‑style helpers; `time.time()`/`time.gmtime()` are fine
  in this standalone script.
- Everything is guarded by `_enum_lock`; never hold `lock` (the broker's socket
  lock) and `_enum_lock` at the same time.

**Verify**: `python3 -m py_compile deploy-mini/broker.py` → exit 0.

### Step 2 — Hook every inbound PUBLISH and the CONNECT into the catalog

One insertion covers all inbound machine→server messages. In the PUBLISH branch
of `client_thread` (`deploy-mini/broker.py:~439`), immediately **after** the two
lines:

```python
                payload=body[i:]
                t=topic.decode(errors='replace')
```

insert:

```python
                if ENUM_ON:
                    try: catalog_observe('in', t, dec_json(payload), len(payload))
                    except Exception: catalog_observe('in', t, None, len(payload))
```

This runs before the existing `if 'auth/login' in t:` dispatch and does not
alter it. It captures `state`, auth, pattern, and any unknown topic uniformly.

Also capture the connection identity. In the CONNECT branch, right after the
existing `if _m: entry[2]['dev']=...` line, add:

```python
                if ENUM_ON:
                    with _enum_lock:
                        _enum['connect'] = {'clientId': cid.decode(errors='replace'),
                                            'proto': pn.decode(errors='replace'),
                                            'level': level, 'keepalive': ka, 'at': _iso()}
```

**Verify**: `python3 -m py_compile deploy-mini/broker.py` → exit 0.

### Step 3 — Start the writer thread in `main()`

In `main()` (`deploy-mini/broker.py:496`), next to the existing
`threading.Thread(target=ctrl_watcher,daemon=True).start()`, add:

```python
    if ENUM_ON:
        threading.Thread(target=catalog_writer, daemon=True).start()
        log('  [ENUM] enumerator BẬT -> %s + %s' % (CATALOG, ENUM_LOG))
```

**Verify**: `python3 -m py_compile deploy-mini/broker.py` → exit 0, and the
import‑safe command from the "Commands" table prints `import ok`.

### Step 4 — Add a safe, off‑by‑default falsification probe to `do_ctrl`

The probe empirically tests the recon conclusion "no server‑initiated message
pulls extra data from the machine." It publishes **informational, non‑mutating**
unsolicited replies and records whether the machine emits anything new.

In `do_ctrl(cmd)` add a new branch (alongside the existing `browse`/`query`/
`data` branches). Target shape:

```python
    elif op == 'enumprobe':
        # Gửi các reply THÔNG TIN vô hại, KHÔNG ghi/không đổi cấu hình máy,
        # rồi để catalog_observe ghi nhận nếu máy phát topic mới.
        hdr = {'mesgNo': '1', 'version': '1.0'}
        safe = [
            ('emCAD/server/v1/pattern/query/ack',      {'isFind': 0, 'barCodeID': 'PROBE', 'patternName': '', 'type': 'DST', 'patternSize': 0}),
            ('emCAD/toA15/v1/pattern/browse/reply',    {'items': [], 'totalNum': 0, 'iCount': 0, 'iPage': 1, 'nPage': 1}),
            ('emCAD/server/v1/pattern/browse/reply',   {'items': [], 'totalNum': 0, 'iCount': 0, 'iPage': 1, 'nPage': 1}),
            ('emCAD/server/v1/userLogin/reply',        {'iResult': 0}),
            ('emCAD/server/toemCAD/v1/state',          {'ping': 1}),
        ]
        for base, bd in safe:
            n, rt = _reply(dev, base, hdr, bd)
            log('  [ENUMPROBE] -> %s (giao %d)' % (rt, n))
        log('  [ENUMPROBE] đã gửi %d reply vô hại; theo dõi enum.log 60s xem máy có phát topic mới không' % len(safe))
```

Hard safety boundaries for this branch — encode them exactly, they are the
reason the probe is LOW risk:
- **Never** include `event/disconnect` (would drop the machine), `auth/*`
  (would corrupt the session), `pattern/data` (file transfer), or any
  `pattern/upload/ack` / `pattern/send/ack` (write paths). The `safe` list above
  is the *complete* allowed set; do not extend it.
- The probe is only reachable by an explicit operator action (writing
  `enumprobe` into `push-cmd.txt`); it never fires on its own.

**Verify**: `python3 -m py_compile deploy-mini/broker.py` → exit 0.

### Step 5 — Write the offline self‑test (no machine, no operator, no network)

Create `deploy-mini/tests/test_enumerator.py`. It imports `broker.py` as a
module (which does not start the server) and drives the catalog directly and via
a synthetic encrypted `state` round‑trip. Model its structure on the existing
`scratchpad/test_push.py` approach: monkeypatch `broker.deliver` to capture,
build encrypted payloads with `broker.aes_enc_json(...).encode()`, and decode
replies with `broker.dec_json`.

The test must assert (target shape — adapt names to your implementation):

```python
import importlib.util, os, sys, json, tempfile
spec = importlib.util.spec_from_file_location('broker',
        os.path.join(os.path.dirname(__file__), '..', 'broker.py'))
broker = importlib.util.module_from_spec(spec); sys.argv=['broker']; spec.loader.exec_module(broker)

# 1) union of keys across states
broker._enum.update({'startedAt': None, 'topics': {}, 'fields': {}, 'states': {}, 'connect': {}})
idle    = {'header': {'companyId': 1, 'userId': 2}, 'body': {'state': 15, 'wstrStatusDesc': 'idle',    'curStitch': 0,    'patternStitch': 0,     'machineName': 'A15'}}
running = {'header': {'companyId': 1, 'userId': 2}, 'body': {'state': 1,  'wstrStatusDesc': 'running', 'curStitch': 1200, 'patternStitch': 9538, 'Speed': 720, 'needleNo': 6}}
brk     = {'header': {'companyId': 1, 'userId': 2}, 'body': {'state': 3,  'wstrStatusDesc': 'break',   'curStitch': 1200, 'threadBreakNeedle': 9, 'errCode': 'E12'}}
for msg in (idle, running, brk):
    p = broker.aes_enc_json(msg).encode()
    broker.catalog_observe('in', 'emCAD/client/v1/state/602602704E7B', broker.dec_json(p), len(p))

snap = broker.catalog_dump()
assert 'body.needleNo' in snap['fields'], 'field chỉ có ở state running phải được bắt'
assert 'body.threadBreakNeedle' in snap['fields'] and 'body.errCode' in snap['fields']
assert set(k for k in snap['states']) == {'wstrStatusDesc=idle','wstrStatusDesc=running','wstrStatusDesc=break'}
assert snap['fields']['body.curStitch']['numMin'] == 0 and snap['fields']['body.curStitch']['numMax'] == 1200
# field xuất hiện nhiều state
assert set(snap['fields']['body.curStitch']['states']) >= {'wstrStatusDesc=idle','wstrStatusDesc=running','wstrStatusDesc=break'}

# 2) undecodable payload is still counted, marked non-decodable, never crashes
broker.catalog_observe('in', 'emCAD/client/v1/weird', None, 42)
assert broker._enum['topics']['emCAD/client/v1/weird']['decodable'] is False

# 3) report writes both artifacts without error
broker.CATALOG  = os.path.join(tempfile.gettempdir(), 'catalog.test.json')
broker.ENUM_LOG = os.path.join(tempfile.gettempdir(), 'enum.test.log')
broker.catalog_report()
assert os.path.exists(broker.CATALOG) and os.path.exists(broker.ENUM_LOG)

print('== ENUM SELF-TEST PASS ==')
```

**Verify**: `python3 deploy-mini/tests/test_enumerator.py` → prints
`== ENUM SELF-TEST PASS ==`, exit 0.

### Step 6 — (Live, requires Mini access — hand off if you lack it) Deploy and capture

This step needs the Mac Mini (SSH key + the live machine). If you are an
executor without that access, **stop here and report Phase A complete**; the
operator will run this step. Exact commands for whoever has access
(`KEY`=path to the Mini SSH key, host `phong@100.105.80.93`):

1. Copy the updated broker to the Mini and byte‑check it there:
   `scp -i "$KEY" -o IdentitiesOnly=yes deploy-mini/broker.py phong@100.105.80.93:'~/dahao-gateway/broker.py'`
   then over SSH: `python3 -m py_compile ~/dahao-gateway/broker.py && echo OK`.
2. Restart the broker (machine reconnects within ~30s):
   `launchctl kickstart -k gui/$(id -u)/com.dahao.broker`.
3. Let it run across a real production window (ideally a full shift, so
   running/error/thread‑break states occur naturally — **no operator action for
   us is required; this is just wall‑clock time**). Then fetch the artifacts:
   `scp -i "$KEY" phong@100.105.80.93:'~/dahao-gateway/{catalog.json,enum.log}' .`
4. (Optional, low‑risk window) run the falsification probe once and watch:
   over SSH `echo enumprobe > ~/dahao-gateway/push-cmd.txt`, wait 60s, then
   check `enum.log` — expected result: **no new machine→server topic appears**
   (only `state`, and the connect/auth topics from the normal cycle). That
   confirms "no server pull path" empirically.

**Verify (live)**: `catalog.json` contains at least the known state fields
(`body.curStitch`, `body.patternStitch`, `body.state`, `body.patternName`,
`header.companyId`) and `enum.log` shows ≥1 state and a non‑zero field count;
the dashboard still serves data (`curl -s -o /dev/null -w '%{http_code}'
http://100.105.80.93:8790/api/v2/fleet` → `200`).

## Test plan

- New test file `deploy-mini/tests/test_enumerator.py` (Step 5), covering:
  happy‑path union of keys across three synthetic states; a state‑specific field
  (`needleNo` only in running) reaching the catalog; numeric min/max tracking;
  an undecodable payload counted but flagged; and both artifacts written without
  error. This is the structural pattern to follow — a standalone script that
  imports `broker.py`, monkeypatches/looks at module globals, and prints a PASS
  sentinel (mirrors `scratchpad/test_push.py`).
- No existing test suite to extend; there is none for the broker.
- Verification: `python3 deploy-mini/tests/test_enumerator.py` → `PASS`, plus
  `python3 -m py_compile deploy-mini/broker.py` → exit 0.

## Done criteria

Phase A (offline — an executor with only this repo can complete ALL of these):

- [ ] `python3 -m py_compile deploy-mini/broker.py` exits 0.
- [ ] `python3 deploy-mini/tests/test_enumerator.py` prints `== ENUM SELF-TEST PASS ==` and exits 0.
- [ ] The import‑safe command prints `import ok` (module has no import‑time side effects; `main()` still only runs under `__main__`).
- [ ] `git diff --stat` shows only `deploy-mini/broker.py` and
      `deploy-mini/tests/test_enumerator.py` changed/created — nothing else.
- [ ] The existing `state` branch's `forward_to_bridge(dev2,b)` call is byte‑for‑byte
      unchanged (`git diff deploy-mini/broker.py` shows only *additions* around
      it, no edits to it).
- [ ] `plans/README.md` status row for 001 updated.

Phase B (live — operator/Mini environment):

- [ ] After a capture window, `catalog.json` lists the known state fields and
      `enum.log` reports ≥1 state and a non‑zero field count.
- [ ] Dashboard `/api/v2/fleet` still returns HTTP 200 (production unaffected).
- [ ] (If probe run) `enum.log` shows no new machine→server topic after
      `enumprobe` — the "no server pull" conclusion is confirmed, or a new topic
      *did* appear and is recorded as a discovery to investigate.

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live `deploy-mini/broker.py`
  (drift since commit `4a76958`) — reconcile before continuing.
- The self‑test fails twice after a reasonable fix attempt.
- Implementing any step appears to require editing `forward_to_bridge`,
  `build_frame`, `state_to_status`, the auth handlers, or the crypto helpers
  (all out of scope) — the design is meant to be purely additive; if it isn't,
  the assumption is wrong.
- **(Live, Step 6 only)** After deploy, the machine fails to reconnect within
  ~2 minutes, disconnects repeatedly, or the dashboard stops returning 200 —
  restore the previous `~/dahao-gateway/broker.py` and report. Keep a copy of
  the pre‑deploy file first.
- The key assumption **"the machine emits `state` autonomously with no operator
  action"** turns out to be false (no `state` arrives at an idle machine) —
  stop; the whole "no operator" premise needs revisiting.

## Maintenance notes

- If a future change makes the broker handle a *new* machine→server topic, add a
  `catalog_observe('in', ...)` call is unnecessary — the single hook in the
  PUBLISH branch already covers every inbound topic. Only outbound (`'out'`)
  observation is not wired; add it inside `deliver` if server→machine cataloging
  is ever wanted.
- The `_flatten` list handling records only the first element's shape and the
  length. If a state body ever carries a heterogeneous array whose later
  elements have different keys, extend `_flatten` to sample more elements.
- A reviewer should scrutinize: (1) that nothing in the `state` production path
  changed; (2) that the probe's `safe` list was not extended with any write/auth
  topic; (3) that no KEY/IV/constant value leaked into `catalog.json`,
  `enum.log`, or the test (they shouldn't, since only decoded message *bodies*
  are cataloged, but confirm the machine never echoes secrets in a body field —
  if a field name looks credential‑like, the catalog should reference the field
  name only, never rotate it into a committed fixture).
- Deferred out of this plan (and why): pulling **EmbNet/SEMS** telemetry (a
  different, richer DaHao protocol shipped as `SemsServer.exe`/`SemsClient.exe`)
  — prior investigation found three pieces of evidence that the A15 does not
  speak EmbNet, so it is a separate spike, not part of this enumerator. Also
  deferred: anything requiring an operator at the HMI (pattern browse/query/
  download/upload) — explicitly excluded by the "no operator" constraint.
