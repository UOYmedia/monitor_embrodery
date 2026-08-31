#!/usr/bin/env python3
# Broker MQTT tối giản (3.1/3.1.1) + bắt tay auth XXTEA cho máy Dahao BECS-A15.
# Mục tiêu: qua được auth/login -> secret -> encode -> confirm để máy publish `state`.
import ast, socket, threading, struct, json, base64, os, sys, time, random
from pathlib import Path
from Crypto.Cipher import AES

HOST='0.0.0.0'; PORT=3865
def _load_aes_secrets():
    secret_path = Path(__file__).with_name('broker_secrets.py')
    try:
        secret_source = secret_path.read_text(encoding='utf-8')
        secret_tree = ast.parse(secret_source, filename=str(secret_path))
    except FileNotFoundError:
        raise RuntimeError(f'Thiếu file cấu hình khoá AES: {secret_path}') from None
    except Exception as exc:
        raise RuntimeError(f'Không đọc được file cấu hình khoá AES {secret_path}: {exc}') from exc

    values = {}
    try:
        for node in secret_tree.body:
            if not isinstance(node, ast.Assign):
                continue
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {'KEY', 'IV'}:
                    values[target.id] = ast.literal_eval(node.value)
    except Exception as exc:
        raise RuntimeError(f'Khoá AES trong {secret_path} không hợp lệ: {exc}') from exc

    missing = {'KEY', 'IV'} - values.keys()
    if missing:
        raise RuntimeError(f'File cấu hình khoá AES {secret_path} thiếu: {", ".join(sorted(missing))}')
    if any(not isinstance(values[name], bytes) or len(values[name]) != 16 for name in ('KEY', 'IV')):
        raise RuntimeError(f'KEY và IV trong {secret_path} phải là bytes dài 16 byte.')
    return values['KEY'], values['IV']

KEY, IV = _load_aes_secrets()
A=[0x40269286,0x7c032a72,0x6a6de9ac,0x5c258294]
B=[0x650a9c4f,0x4ef3306a,0x32c03b32,0x59770a4a]
LOG=os.path.join(os.path.dirname(__file__),'broker.log')
STATE=os.path.join(os.path.dirname(__file__),'state.log')
lock=threading.Lock()
clients=[]  # danh sách (sock, subs set)

# ---- S‑11 / K‑20c: đo nhịp `state` --------------------------------------------------------
# Vì sao có: nhịp TRUNG BÌNH (1,54 s/bản) tính được từ tổng/dải, nhưng MIN/MAX thì không —
# `broker.log` không đóng dấu giờ từng dòng và `enum-growth.csv` không đếm bản tin. Mà trung bình
# lại đúng là con số vô hại nhất: một tuyến đứng im 40 giây rồi phun 30 bản trong một giây vẫn ra
# đúng 1,54 s/bản. Muốn biết tuyến có THẬT SỰ đều hay không thì phải nhìn hai đầu, không nhìn giữa.
NHIP_CSV=os.path.join(os.path.dirname(__file__),'nhip-state.csv')
NHIP_CUA_SO=300.0          # gộp 5 phút một dòng: 288 dòng/ngày. Ghi từng bản tin thì 4 ngày đã
                           # hơn 100.000 dòng — đo mà làm phình đúng cái đang đo thì đo làm gì.
_nhip_lock=threading.Lock()
_nhip={}                   # dev -> {mo, truoc, ds:[Δ...], van: chữ ký bản trước, lap: số bản trùng}

def _nhip_ghi(hang):
    try:
        moi=not os.path.exists(NHIP_CSV)
        with open(NHIP_CSV,'a') as f:
            if moi: f.write('luc,dev,so_ban,giay_min,giay_giua,giay_max,so_lap\n')
            f.write(hang+'\n')
    except Exception as e:
        log('  [NHIP] không ghi được %s: %s'%(NHIP_CSV,e))

def nhip_state(dev, van):
    """Ghi nhận một bản tin `state`; trả `(mốc ISO, chuỗi Δ)` để đóng dấu lên dòng log.

    `van` = chữ ký nội dung (state, cur, tot, pat). Hai bản liên tiếp cùng chữ ký nghĩa là máy
    nhắc lại y nguyên điều nó vừa nói — đó chính là 79,8 % dòng log mà K‑20c nói tới. Đếm được
    thì mới biết gộp dòng lãi đúng bao nhiêu; chưa đếm mà đã gộp là bỏ dữ liệu theo linh cảm.
    """
    now=time.time()
    xong=None
    with _nhip_lock:
        m=_nhip.get(dev)
        if m is None:
            m={'mo':now,'truoc':None,'ds':[],'van':None,'lap':0}; _nhip[dev]=m
        # Bản ĐẦU TIÊN không có Δ. Ghi 0 cho đẹp cột là bịa ra một nhịp chưa hề đo được, và nó
        # kéo `giay_min` xuống 0 vĩnh viễn — đúng con số mà S‑11 cần chính xác.
        d=None if m['truoc'] is None else now-m['truoc']
        if d is not None: m['ds'].append(d)
        if m['van'] is not None and van==m['van']: m['lap']+=1
        m['truoc']=now; m['van']=van
        if now-m['mo']>=NHIP_CUA_SO and m['ds']:
            ds=sorted(m['ds'])
            xong='%s,%s,%d,%.3f,%.3f,%.3f,%d'%(
                time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime(now)),dev,len(ds)+1,
                ds[0],ds[len(ds)//2],ds[-1],m['lap'])
            # Cửa sổ mới bắt đầu NGAY tại bản này (`truoc`=now), không để rơi mất khoảng nối.
            _nhip[dev]={'mo':now,'truoc':now,'ds':[],'van':van,'lap':0}
    # Ghi ra NGOÀI vùng khoá: `_nhip_ghi` có thể gọi `log()`, mà `log()` giữ `lock`. Ôm hai khoá
    # lồng nhau là cách tự dựng một thế kẹt chỉ hiện ra lúc hai máy nói cùng lúc.
    if xong: _nhip_ghi(xong)
    return (time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime(now))+'Z',
            '-' if d is None else '%.3fs'%d)

def log(*a):
    line=' '.join(str(x) for x in a)
    with lock:
        with open(LOG,'a') as f: f.write(line+'\n')
    print(line, flush=True)

def _xoay_log():
    """[V1] Doi ten broker.log cu thay vi cat trang, de con lich su ma soi.
    Giu toi da 10 ban gan nhat."""
    try:
        if os.path.exists(LOG) and os.path.getsize(LOG) > 0:
            os.rename(LOG, LOG + '.' + time.strftime('%Y%m%d-%H%M%S'))
    except OSError:
        pass
    try:
        d = os.path.dirname(LOG) or '.'
        cu = sorted(f for f in os.listdir(d)
                    if f.startswith(os.path.basename(LOG) + '.'))
        for f in cu[:-10]:
            try: os.remove(os.path.join(d, f))
            except OSError: pass
    except OSError:
        pass

def xxtea_encrypt(v, key):
    v=list(v); n=len(v); DELTA=0x9E3779B9; m=0xFFFFFFFF
    q=6+52//n; s=0; z=v[n-1]
    for _ in range(q):
        s=(s+DELTA)&m; e=(s>>2)&3
        for p in range(n):
            y=v[(p+1)%n]
            mx=((((z>>5)^((y<<2)&m))+(((y>>3))^((z<<4)&m)))&m) ^ (((s^y)+(key[(p&3)^e]^z))&m)
            v[p]=(v[p]+mx)&m; z=v[p]
    return v

def s32(x):  # uint32 -> int32 (JSON của jsoncpp dùng int có dấu)
    return x-0x100000000 if x>=0x80000000 else x
def u32(x):
    return x & 0xFFFFFFFF

def aes_dec(b64):
    raw=base64.b64decode(b64)
    return AES.new(KEY,AES.MODE_CBC,IV).decrypt(raw)
def dec_json(payload):
    pt=aes_dec(payload)
    if pt:
        pad=pt[-1]
        if 1<=pad<=16 and pt[-pad:]==bytes([pad])*pad:  # bỏ đệm PKCS7 đúng chuẩn
            pt=pt[:-pad]
    return json.loads(pt.decode('utf-8','ignore').strip())
def aes_enc_json(obj):
    js=json.dumps(obj)  # nội dung JSON compact
    data=js.encode()
    pad=16-(len(data)%16)          # PKCS7 (máy dùng: login kết thúc }\x02\x02)
    data=data+bytes([pad])*pad
    ct=AES.new(KEY,AES.MODE_CBC,IV).encrypt(data)
    return base64.b64encode(ct).decode()

# ---- MQTT framing ----
def read_exact(sock,n):
    buf=b''
    while len(buf)<n:
        c=sock.recv(n-len(buf))
        if not c: return None
        buf+=c
    return buf
def read_remlen(sock):
    mult=1; val=0
    while True:
        b=read_exact(sock,1)
        if b is None: return None
        b=b[0]; val+=(b&0x7f)*mult
        if not (b&0x80): break
        mult*=128
    return val
def enc_remlen(n):
    out=b''
    while True:
        d=n%128; n//=128
        if n>0: d|=0x80
        out+=bytes([d])
        if n<=0: break
    return out
def rd_str(buf,i):
    l=struct.unpack_from('>H',buf,i)[0]; i+=2
    return buf[i:i+l], i+l

def mk_publish(topic, payload, qos=0):
    tb=topic.encode()
    vh=struct.pack('>H',len(tb))+tb
    if qos>0: vh+=struct.pack('>H',1)  # packet id
    body=vh+payload
    return bytes([0x30|(qos<<1)])+enc_remlen(len(body))+body

def deliver(topic, payload, plain=None):
    # gửi tới mọi client có subscription khớp
    with lock:
        targets=[c for c in clients if any(sub_match(s,topic) for s in c[1])]
    pkt=mk_publish(topic,payload,0)
    for c in targets:
        try: c[0].sendall(pkt)
        except Exception as e: log('deliver err',e)
    return len(targets)

def sub_match(sub, topic):
    ss=sub.split('/'); ts=topic.split('/')
    for i,s in enumerate(ss):
        if s=='#': return True
        if i>=len(ts): return False
        if s=='+': continue
        if s!=ts[i]: return False
    return len(ss)==len(ts)

def prettytxt(pt):
    try: return pt.rstrip(b' \x00').decode('utf-8')
    except: return repr(pt)

def handle_auth_login(conn_sub, topic, payload):
    # payload = base64 (bytes). Giải mã, lấy Nc, dựng auth/secret.
    try:
        js=dec_json(payload)
    except Exception as e:
        log('  login decrypt/parse lỗi:', e, 'raw=', prettytxt(payload)[:80]); return
    dev=topic.split('/')[-1]
    try:
        if len(conn_sub)>2 and _re.match(r'^[0-9A-Fa-f]{12}$',dev): conn_sub[2]['dev']=dev
    except Exception: pass
    body=js.get('body',{}); hdr=js.get('header',{})
    Nc=[u32(int(x)) for x in body.get('secret',[0,0,0,0])][:4]
    while len(Nc)<4: Nc.append(Nc[-1] if Nc else 0)
    # SERVER THẬT (đã dịch ngược): secret = 4 giá trị GIỐNG NHAU trong [1e8, 1e8+32767]
    nsv=random.randint(10**8, 10**8+32767)
    Ns=[nsv,nsv,nsv,nsv]
    encode=[u32(x) for x in xxtea_encrypt(A, Nc)]     # body.encode = XXTEA(A, Nc)
    expect=[u32(x) for x in xxtea_encrypt(B, Ns)]     # mã client kỳ vọng = XXTEA(B, Ns)
    with lock:
        s=SESS.setdefault(dev,{'expects':[]})
        s['Ns']=Ns; s['Nc']=Nc; s['expect']=expect
        s['expects'].append(expect)
        s['expects']=s['expects'][-60:]   # giữ 60 giá trị kỳ vọng gần nhất
    # secret & encode PHẢI là REAL(double) đúng như jsoncpp fildl (signed int32 -> double)
    reply={"header":{"mesgNo":str(hdr.get('mesgNo',"1")),"version":"1.0"},
           "body":{"secret":[float(s32(x)) for x in Ns],
                   "encode":[float(s32(x)) for x in encode]}}
    ct=aes_enc_json(reply)
    rtopic='emCAD/server/v1/auth/secret/'+dev
    n=deliver(rtopic, ct.encode(), reply)
    log('  << login mesgNo=%s Nc=%d | >> secret Ns=%d encode=%s expect=%s (sub=%d)'%(hdr.get('mesgNo'),Nc[0],nsv,encode,expect,n))

def handle_auth_encode(topic, payload):
    try:
        js=dec_json(payload)
    except Exception as e:
        log('  encode parse lỗi:',e); return
    dev=topic.split('/')[-1]
    enc=[u32(int(x)) for x in js.get('body',{}).get('encode',[])][:4]
    sess=SESS.get(dev) or {}
    expects=sess.get('expects') or ([sess['expect']] if sess.get('expect') else [])
    match = enc in expects
    log('  ################ MÁY GỬI auth/encode! enc=%s  (khớp 1 trong %d expect gần đây=%s)'%(enc,len(expects),match))
    hdr=js.get('header',{})
    if match:
        # SERVER THẬT: auth/confirm body chỉ có ackMesg = 0 (real). KHÔNG iResult, KHÔNG reason.
        confirm={"header":{"mesgNo":str(hdr.get('mesgNo',"1")),"version":"1.0"},
                 "body":{"ackMesg":0.0}}
        ct=aes_enc_json(confirm)
        rtopic='emCAD/server/v1/auth/confirm/'+dev
        n=deliver(rtopic, ct.encode())
        log('  >> auth/confirm ackMesg=0 KHỚP -> gửi (giao tới %d sub) *** AUTH XONG ***'%n)

SESS={}
HYPO_I=[0]

# ---- Forward state đã giải mã -> cổng dial-in của bridge (JSON contract, newline-delimited) ----
FWD_HOST=os.environ.get('BRIDGE_HOST','127.0.0.1')
FWD_PORT=int(os.environ.get('BRIDGE_PORT','1600'))
FWD_ON=os.environ.get('FWD_ENABLE','1')!='0'
_fwd={'sock':None,'last_try':0.0}
_prev={}  # dev -> (patternName, curStitch): suy status từ việc curStitch có tăng không

def _iso():
    return time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime())+'Z'

def state_to_status(dev, body):
    # Enum `state` không mã hoá chuỗi trong exe; suy status TRUNG THỰC từ curStitch.
    st=body.get('state'); cur=body.get('curStitch'); pat=body.get('patternName')
    if st==-1: return 'unknown'          # sentinel mất dữ liệu
    prev=_prev.get(dev); _prev[dev]=(pat,cur)
    if prev and prev[0]==pat and isinstance(cur,int) and isinstance(prev[1],int):
        return 'running' if cur>prev[1] else 'stopped'
    return 'unknown'                      # lần đầu / vừa đổi mẫu: chưa đủ cơ sở

def controller_state_event(body, at):
    """[E2] Lời MÁY TỰ NÓI về trạng thái của nó, chuyển nguyên văn sang bridge.

    Vì sao đi bằng `events[]` chứ không bằng một khoá mới: hợp đồng bridge không có chỗ nào
    chứa lời máy ở tầng `status` (enum cứng 5 giá trị, contract.mjs:283), và khoá lạ ở cấp
    trên cùng bị bridge BỎ QUA lặng lẽ — gửi cũng như không. `events[].code` và
    `events[].message` là văn bản tự do, đi thẳng tới màn hình nguyên văn. Không phải đổi
    hợp đồng một dòng nào.

    severity CỐ Ý là 'info': alerts.mjs bỏ qua đúng mức này (`if event.severity === 'info'`).
    Máy đẩy nhịp `state` liên tục; phong nó thành 'warning' là biến mỗi nhịp tim thành một
    cảnh báo, và cảnh báo nào cũng kêu thì không cảnh báo nào được đọc. Khi nào biết chắc
    trạng thái nào là LỖI (cần một ca chạy thật) thì mới nâng mức — đó là việc E3.

    Máy không nói thì KHÔNG nói hộ: thiếu mô tả hoặc thiếu số hiệu ⇒ trả None.
    """
    desc = body.get('wstrStatusDesc')
    if not isinstance(desc, str) or not desc.strip(): return None
    sid = body.get('stateID')
    if sid is None: sid = body.get('state')
    if sid is None: return None
    code = str(sid)[:40]              # contract.mjs:224 chặn 40
    return {'id': 'state-' + code,    # <=46: contract.mjs:236 chặn 80, vượt là bridge TỪ CHỐI CẢ GÓI
            'code': code,
            'severity': 'info',
            'source': 'controller',
            'occurredAt': at,
            'message': desc.strip()[:400]}  # contract.mjs:239 chặn 400

def build_frame(dev, body):
    # KHÔNG map curStitch->odometer: curStitch reset theo từng mẫu, không đơn điệu.
    at = _iso()
    frame = {'observedAt':at,'status':state_to_status(dev,body),
             'job':{'fileName':body.get('patternName') or None,
                    'currentStitch':body.get('curStitch'),
                    'totalStitches':body.get('patternStitch')}}
    # [E2] THUẦN CỘNG THÊM: ba khoá trên giữ nguyên từng byte cho mọi trường hợp đang chạy.
    event = controller_state_event(body, at)
    if event is not None: frame['events'] = [event]
    return frame

def forward_to_bridge(dev, body):
    if not FWD_ON: return
    try:
        line=(json.dumps(build_frame(dev,body),separators=(',',':'))+'\n').encode()
        s=_fwd['sock']
        if s is None:
            now=time.time()
            if now-_fwd['last_try']<5: return  # backoff khi bridge chưa lên
            _fwd['last_try']=now
            s=socket.create_connection((FWD_HOST,FWD_PORT),timeout=2)
            _fwd['sock']=s; log('  [FWD] nối bridge %s:%d OK'%(FWD_HOST,FWD_PORT))
        s.sendall(line)
    except Exception as e:
        log('  [FWD] lỗi (%s) -> đóng socket'%e)
        try: _fwd['sock'].close()
        except: pass
        _fwd['sock']=None

def xxtea_decrypt(v, key):
    v=list(v); n=len(v); DELTA=0x9E3779B9; m=0xFFFFFFFF
    q=6+52//n; s=(q*DELTA)&m
    y=v[0]
    for _ in range(q):
        e=(s>>2)&3
        for p in range(n-1,-1,-1):
            z=v[(p-1)%n]
            mx=((((z>>5)^((y<<2)&m))+(((y>>3))^((z<<4)&m)))&m) ^ (((s^y)+(key[(p&3)^e]^z))&m)
            v[p]=(v[p]-mx)&m; y=v[p]
        s=(s-DELTA)&m
    return v

# Danh sách giả thuyết cho body.encode (proof server gửi để client xác thực).
# Trả (field_encode_values, field_secret_values_override_or_None, ten)
def hypo(idx, A, B, Nc4, Ns):
    Nc=Nc4[0]
    E=lambda v,k: [u32(x) for x in xxtea_encrypt([u32(t) for t in v],[u32(t) for t in k])]
    D=lambda v,k: [u32(x) for x in xxtea_decrypt([u32(t) for t in v],[u32(t) for t in k])]
    H=[
      ("enc(A,Nc)",       E(A,Nc4),      None),
      ("enc(Nc,A)",       E(Nc4,A),      None),
      ("dec(A,Nc)",       D(A,Nc4),      None),
      ("dec(Nc,A)",       D(Nc4,A),      None),
      ("enc(A,Ns)",       E(A,Ns),       None),
      ("enc(Ns,A)",       E(Ns,A),       None),
      ("enc(B,Nc)",       E(B,Nc4),      None),
      ("enc(Nc,B)",       E(Nc4,B),      None),
      ("enc(B,Ns)",       E(B,Ns),       None),   # server gửi luôn đáp án kỳ vọng
      ("enc(Ns,B)",       E(Ns,B),       None),
      ("secret=enc(A,Nc)",E(B,Ns),       E(A,Nc4)),  # proof ở field secret, encode=đáp án
      ("plainNs",         Ns,            None),      # encode = Ns (không transform)
      ("enc(A,Nc)_uns",   E(A,Nc4),      None),      # (đánh dấu để gửi unsigned)
    ]
    return H[idx % len(H)]



# ================== ĐẨY MẪU (.DST) XUỐNG MÁY — máy KÉO, server chỉ trả lời ==================
# Spec (RE từ DesignServer.exe): mọi reply bọc AES-CBC+PKCS7+base64 (như auth/state).
#  máy fromA15/pattern/browse         -> ta toA15/.../browse/reply {items,totalNum,...}
#  máy client/pattern/query{barCodeID}-> ta server/pattern/query/ack {isFind,barCodeID,patternName,type,patternSize}
#  máy client/pattern/download{fileStart,byteLen,barCodeID} -> ta server/pattern/data {barCodeID,data=b64 slice,fileStart,patternName}
#  máy client/pattern/data/ack        -> CHỈ log (KHÔNG chặn chunk kế; chunk kế do máy tự xin qua download mới).
import re as _re
PATTERN_DIR=os.path.join(os.path.dirname(__file__),'patterns')
PATTERNS={}   # barCodeID(str) -> dict metadata + data(bytes)

def _dst_meta(raw):
    h=raw[:512].decode('latin-1','ignore')
    def g(tag):
        m=_re.search(_re.escape(tag)+r':\s*([+\-]?\d+)',h)
        return int(m.group(1)) if m else 0
    return {'needle':g('ST'),'color':g('CO'),'width':g('+X')+g('-X'),'height':g('+Y')+g('-Y')}

NAP_CSV=os.path.join(os.path.dirname(__file__),'patterns-nap.csv')

def _ghi_nap_csv(hang):
    """Một dòng cho mỗi lần nạp. Cần CSV chứ không chỉ log vì câu hỏi "đẩy mẫu mất bao lâu"
    phải trả lời bằng phân bố qua nhiều lần, không phải bằng một con số nhớ mang máng."""
    try:
        moi=not os.path.exists(NAP_CSV)
        with open(NAP_CSV,'a') as f:
            if moi: f.write('luc,so_mau,so_bo,so_byte,ms_liet_ke,ms_doc,ms_kiem,ms_tong\n')
            f.write(hang+'\n')
    except Exception as e:
        log('  [PATTERNS] không ghi được %s: %s'%(NAP_CSV,e))

def _dst_hop_le(raw):
    """(được_nạp, vì_sao). Cửa duy nhất giữa "một file nào đó có đuôi .dst" và "một mẫu ta dám
    đẩy xuống máy thêu". Máy KHÔNG kiểm hộ ta: nó nhận gì thì thêu nấy, nên nếu ta không chặn ở
    đây thì chỗ đầu tiên phát hiện ra file rác sẽ là một mẻ hàng hỏng trên khung."""
    if len(raw) < 512+3:
        return False, 'chỉ %d B — ngắn hơn cả cái header 512 B của .DST'%len(raw)
    dau=raw[:512].decode('latin-1','ignore')
    if 'LA:' not in dau:
        return False, 'header không có trường LA: — đây không phải file .DST'
    if not _re.search(r'ST:\s*(\d+)', dau):
        return False, 'header không có số mũi (ST:)'
    st=_dst_meta(raw)['needle']
    if st<=0:
        return False, 'header khai 0 mũi'
    # Thân .DST là các bản ghi 3 byte. Khai N mũi mà thân không đủ 3*N byte nghĩa là file cụt —
    # thường do sao chép dở dang. Đẩy một file cụt xuống máy còn tệ hơn không đẩy gì.
    thieu=3*st-(len(raw)-512)
    if thieu>0:
        return False, 'cụt: khai %d mũi (cần %d B thân) nhưng thiếu %d B'%(st,3*st,thieu)
    return True, ''

def load_patterns():
    PATTERNS.clear()
    if not os.path.isdir(PATTERN_DIR):
        log('  [PATTERNS] chưa có thư mục %s'%PATTERN_DIR); return
    # Gom rồi sắp trước khi nạp. `os.walk` KHÔNG hứa thứ tự thư mục, nên nếu hai file cùng mã thì
    # bản nào thắng sẽ khác nhau giữa các máy — cùng một thư mục `patterns/` cho ra hai kết quả.
    t0=time.perf_counter(); ms_doc=0.0; ms_kiem=0.0; so_bo=0; so_byte=0
    duong=[]
    for root,dirs,files in os.walk(PATTERN_DIR):
        dirs.sort()
        for fn in files:
            if fn.lower().endswith('.dst'): duong.append(os.path.join(root,fn))
    duong.sort()
    t_liet_ke=time.perf_counter()
    for path in duong:
        fn=os.path.basename(path); root=os.path.dirname(path)
        ta=time.perf_counter()
        try: raw=open(path,'rb').read()
        except Exception as e: log('  [PATTERNS] đọc lỗi',path,e); continue
        tb=time.perf_counter(); ms_doc+=(tb-ta)*1000; so_byte+=len(raw)
        ok,vi_sao=_dst_hop_le(raw)
        ms_kiem+=(time.perf_counter()-tb)*1000
        if not ok:
            so_bo+=1; log('  [PATTERNS] BỎ %s: %s'%(fn,vi_sao)); continue
        base=os.path.splitext(fn)[0]; ext=(os.path.splitext(fn)[1].lstrip('.').upper() or 'DST')
        folder=os.path.basename(root)
        code=folder if folder.isdigit() else base.split('_')[0]
        if not code.isdigit():
            # Không chặn: chưa có bằng chứng nào nói máy A15 từ chối mã chữ, mà chặn nhầm thì
            # mất mẫu. Nhưng phải kêu lên — một mã chữ lẳng lặng vào danh sách chỉ lộ ra ở xưởng.
            log('  [PATTERNS] ⚠ mã mẫu %r (suy từ %s) KHÔNG phải chữ số; vẫn nạp nhưng để mắt'%(code,fn))
        if code in PATTERNS:
            log('  [PATTERNS] ⚠ TRÙNG MÃ %s: giữ %s, BỎ %s (chốt: đường dẫn nhỏ hơn theo thứ tự '
                'chữ thì thắng — cố định giữa các máy)'%(code,PATTERNS[code]['patternName'],fn))
            continue
        m=_dst_meta(raw)
        PATTERNS[code]={'barCodeID':code,'patternName':base,'type':ext,'patternSize':len(raw),
            'data':raw,'drawingNeedleCn':m['needle'],'drawingColorCn':m['color'],
            'drawingWidth':m['width'],'drawingHeight':m['height'],'drawingFileLen':len(raw)}
    ms_tong=(time.perf_counter()-t0)*1000; ms_liet_ke=(t_liet_ke-t0)*1000
    log('  [PATTERNS] nạp %d mẫu: %s'%(len(PATTERNS),
        ' | '.join('%s->%s(%dB,%dmũi)'%(c,p['patternName'],p['patternSize'],p['drawingNeedleCn']) for c,p in PATTERNS.items())))
    # `T_chuẩn bị` = chặng DUY NHẤT của việc đẩy mẫu nằm trong tay ta. Chặng kế (`T_chờ máy hỏi`)
    # do máy quyết định — emCAD không có topic nào để server gọi máy — nên đừng gộp hai cái vào
    # một con số rồi bảo "đẩy mẫu mất chừng đó".
    log('  [PATTERNS] T_chuẩn bị = %.1f ms cho %d mẫu / %d B (liệt kê %.1f · đọc %.1f · kiểm %.1f), bỏ %d file'
        %(ms_tong,len(PATTERNS),so_byte,ms_liet_ke,ms_doc,ms_kiem,so_bo))
    _ghi_nap_csv('%s,%d,%d,%d,%.3f,%.3f,%.3f,%.3f'%(
        time.strftime('%Y-%m-%dT%H:%M:%S'),len(PATTERNS),so_bo,so_byte,ms_liet_ke,ms_doc,ms_kiem,ms_tong))

def _dev_of(entry, topic):
    d=entry[2].get('dev') if len(entry)>2 else None
    if d: return d
    last=topic.split('/')[-1]
    return last

def _item(p):
    return {'barCodeID':p['barCodeID'],'patternNetID':p['barCodeID'],'patternName':p['patternName'],'type':p['type'],
            'patternSize':p['patternSize'],'drawingNeedleCn':p['drawingNeedleCn'],
            'drawingColorCn':p['drawingColorCn'],'drawingWidth':p['drawingWidth'],
            'drawingHeight':p['drawingHeight'],'drawingFileLen':p['drawingFileLen']}

def _reply(dev, base_topic, req_hdr, body):
    obj={'header':{'mesgNo':str((req_hdr or {}).get('mesgNo','1')),'version':'1.0'},'body':body}
    ct=aes_enc_json(obj)
    topic=base_topic+'/'+dev
    return deliver(topic,ct.encode(),obj), topic

def _send_browse(dev, hdr, req_body=None):
    rq=req_body if isinstance(req_body,dict) else {}
    items=[_item(p) for p in PATTERNS.values()]
    ipage=int(rq.get('iPage',0) or 0)
    per=int(rq.get('iCount',0) or 0) or (len(items) or 1)
    npage=max(1,(len(items)+per-1)//per)
    rb={'items':items,'totalNum':len(items),'iCount':len(items),
        'iPage':ipage,'nPage':npage,
        'userId':rq.get('userId',0),'companyId':rq.get('companyId',0)}
    tot=0
    for base in ('emCAD/toA15/v1/pattern/browse/reply','emCAD/server/v1/pattern/browse/reply'):
        n,rt=_reply(dev,base,hdr,rb); tot+=n
    log('  [browse REPLY] items=%d iPage=%d nPage=%d uid=%s cid=%s giao %d sub (dev=%s)'%(len(items),ipage,npage,rb['userId'],rb['companyId'],tot,dev))
    return tot

def _find(body):
    code=str(body.get('barCodeID','')) if body.get('barCodeID') is not None else ''
    p=PATTERNS.get(code)
    if not p:
        nid=body.get('patternNetID')
        if nid not in (None,''):
            p=PATTERNS.get(str(nid))
            if p: code=p['barCodeID']
    if not p:
        pn=body.get('patternName')
        p=next((x for x in PATTERNS.values() if x['patternName']==pn),None)
        if p: code=p['barCodeID']
    return code,p

def handle_pattern_browse(entry, topic, payload):
    dev=_dev_of(entry,topic)
    try: js=dec_json(payload)
    except Exception as e: log('  [browse] parse lỗi',e); js={}
    body=js.get('body',{})
    log('  [browse REQ] dev=%s body=%s'%(dev,json.dumps(body,ensure_ascii=False)[:220]))
    _send_browse(dev,js.get('header',{}),body)

def handle_pattern_query(entry, topic, payload):
    dev=_dev_of(entry,topic)
    try: js=dec_json(payload)
    except Exception as e: log('  [query] parse lỗi',e); return
    hdr=js.get('header',{}); body=js.get('body',{})
    code,p=_find(body)
    log('  [query REQ] dev=%s barCodeID=%s body=%s'%(dev,code,json.dumps(body,ensure_ascii=False)[:220]))
    if p: rb={'isFind':1,'barCodeID':p['barCodeID'],'patternName':p['patternName'],'type':p['type'],'patternSize':p['patternSize']}
    else: rb={'isFind':0,'barCodeID':code,'patternName':body.get('patternName',''),'type':'DST','patternSize':0}
    n,rt=_reply(dev,'emCAD/server/v1/pattern/query/ack',hdr,rb)
    log('  [query ACK] -> %s isFind=%d size=%s (giao %d sub)'%(rt,rb['isFind'],rb.get('patternSize'),n))

def handle_pattern_download(entry, topic, payload):
    dev=_dev_of(entry,topic)
    try: js=dec_json(payload)
    except Exception as e: log('  [download] parse lỗi',e); return
    hdr=js.get('header',{}); body=js.get('body',{})
    code,p=_find(body)
    fs=int(body.get('fileStart',0) or 0); bl=int(body.get('byteLen',0) or 0)
    log('  [download REQ] dev=%s code=%s fileStart=%d byteLen=%d found=%s'%(dev,code,fs,bl,bool(p)))
    if not p: log('  [download] KHÔNG có mẫu cho %s'%code); return
    raw=p['data']
    fs=max(0,min(fs,len(raw)))
    if bl<=0: bl=len(raw)-fs
    end=min(fs+bl,len(raw)); sl=raw[fs:end]
    rb={'barCodeID':p['barCodeID'],'data':base64.b64encode(sl).decode(),'fileStart':fs,'patternName':p['patternName']}
    n,rt=_reply(dev,'emCAD/server/v1/pattern/data',hdr,rb)
    log('  [pattern/data] -> %s bytes[%d:%d]=%d/%d b64len=%d (giao %d sub)'%(rt,fs,end,len(sl),len(raw),len(rb['data']),n))

def handle_pattern_dataack(entry, topic, payload):
    dev=_dev_of(entry,topic)
    try: body=dec_json(payload).get('body',{})
    except Exception as e: log('  [data/ack] parse lỗi',e); return
    log('  [data/ack] dev=%s body=%s'%(dev,json.dumps(body,ensure_ascii=False)[:220]))

# --- Probe thủ công (thử Risk#1): ghi 1 dòng vào push-cmd.txt để CHỦ ĐỘNG đẩy ---
#   browse            = gửi danh sách mẫu (nhử máy)
#   query <barCodeID> = gửi query/ack isFind=1
#   data  <barCodeID> = gửi nguyên file trong 1 pattern/data (fileStart=0)
CTRL=os.path.join(os.path.dirname(__file__),'push-cmd.txt')
def _first_dev():
    with lock:
        for c in clients:
            d=c[2].get('dev') if len(c)>2 else None
            if d: return d
    return None
def do_ctrl(cmd):
    dev=_first_dev()
    if not dev: log('  [CTRL] chưa có máy nối, bỏ qua: %s'%cmd); return
    parts=cmd.split(); op=parts[0] if parts else ''
    hdr={'mesgNo':'1','version':'1.0'}
    if op=='browse':
        _send_browse(dev,hdr)
    elif op=='query' and len(parts)>1:
        p=PATTERNS.get(parts[1])
        if not p: log('  [CTRL query] không có %s'%parts[1]); return
        n,rt=_reply(dev,'emCAD/server/v1/pattern/query/ack',hdr,{'isFind':1,'barCodeID':p['barCodeID'],'patternName':p['patternName'],'type':p['type'],'patternSize':p['patternSize']})
        log('  [CTRL query] -> %s (giao %d)'%(rt,n))
    elif op=='data' and len(parts)>1:
        p=PATTERNS.get(parts[1])
        if not p: log('  [CTRL data] không có %s'%parts[1]); return
        n,rt=_reply(dev,'emCAD/server/v1/pattern/data',hdr,{'barCodeID':p['barCodeID'],'data':base64.b64encode(p['data']).decode(),'fileStart':0,'patternName':p['patternName']})
        log('  [CTRL data] -> %s toàn bộ %dB (giao %d)'%(rt,p['patternSize'],n))
    elif op=='enumprobe':
        # Kiểm chứng phản chứng: gửi các reply THÔNG TIN vô hại (KHÔNG ghi/không đổi cấu hình máy)
        # rồi xem máy có phát topic mới không -> xác nhận "KHÔNG có đường server-pull".
        # DANH SÁCH AN TOÀN ĐÓNG: tuyệt đối không disconnect/auth/pattern-data/upload (đường ghi/điều khiển).
        safe=[
            ('emCAD/server/v1/pattern/query/ack',    {'isFind':0,'barCodeID':'PROBE','patternName':'','type':'DST','patternSize':0}),
            ('emCAD/toA15/v1/pattern/browse/reply',  {'items':[],'totalNum':0,'iCount':0,'iPage':1,'nPage':1}),
            ('emCAD/server/v1/pattern/browse/reply', {'items':[],'totalNum':0,'iCount':0,'iPage':1,'nPage':1}),
            ('emCAD/server/v1/userLogin/reply',      {'iResult':0}),
            ('emCAD/server/toemCAD/v1/state',        {'ping':1}),
        ]
        for base,bd in safe:
            n,rt=_reply(dev,base,hdr,bd)
            log('  [ENUMPROBE] -> %s (giao %d)'%(rt,n))
        log('  [ENUMPROBE] đã gửi %d reply vô hại; theo dõi enum.log ~60s xem có topic máy->server mới không'%len(safe))
    else:
        log('  [CTRL] lệnh lạ: %s'%cmd)
def ctrl_watcher():
    while True:
        try:
            if os.path.exists(CTRL):
                cmd=open(CTRL).read().strip()
                if cmd:
                    open(CTRL,'w').close()
                    log('  [CTRL] nhận lệnh: %s'%cmd); do_ctrl(cmd)
        except Exception as e: log('  [CTRL] lỗi',e)
        time.sleep(1)

def client_thread(sock, addr):
    subs=set(); entry=[sock,subs,{'dev':None}]
    with lock: clients.append(entry)
    log('== KẾT NỐI TCP từ', addr)
    # [V2] Han doc ban dau: ai noi CONNECT khong xong trong 60s thi cat.
    # Sau khi doc duoc keepalive cua may se siet lai theo dung con so may khai.
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        sock.settimeout(60)
    except OSError:
        pass
    try:
        while True:
            hdr=read_exact(sock,1)
            if hdr is None: break
            typ=hdr[0]>>4; flags=hdr[0]&0xf
            rl=read_remlen(sock)
            if rl is None: break
            body=read_exact(sock,rl) if rl>0 else b''
            if body is None: break
            if typ==1:  # CONNECT
                pn,i=rd_str(body,0); level=body[i]; cflags=body[i+1]
                ka=struct.unpack_from('>H',body,i+2)[0]; i+=4
                cid,i=rd_str(body,i)
                log('CONNECT proto=%s lvl=%d cid=%s keepalive=%d cleanSession=%d cflags=0x%02x'%(pn.decode(errors='replace'),level,cid.decode(errors='replace'),ka,(cflags>>1)&1,cflags))
                _m=_re.match(r'([0-9A-Fa-f]{12})',cid.decode(errors='replace'))
                if _m:
                    entry[2]['dev']=_m.group(1); log('  [dev] = %s (từ clientId)'%_m.group(1))
                    # [V3] Chuan MQTT: cung clientId thi phien CU phai bi da ra.
                    # Neu khong, xac chet nam lai trong clients va deliver() dem nham.
                    _cu=[]
                    with lock:
                        for _c in list(clients):
                            if _c is not entry and _c[2].get('dev')==_m.group(1):
                                _cu.append(_c); clients.remove(_c)
                    for _c in _cu:
                        log('  [V3] đá phiên cũ cùng dev %s'%_m.group(1))
                        try: _c[0].shutdown(socket.SHUT_RDWR)
                        except OSError: pass
                        try: _c[0].close()
                        except OSError: pass
                if ENUM_ON:  # ghi danh tính máy (CONNECT metadata) vào catalog
                    with _enum_lock:
                        _enum['connect']={'clientId':cid.decode(errors='replace'),
                                          'proto':pn.decode(errors='replace'),
                                          'level':level,'keepalive':ka,'at':_iso()}
                # [V2] May khai keepalive=ka giay. Chuan MQTT: qua 1.5*ka ma im
                # thi coi nhu chet. Lay 2*ka cho rong tay, toi thieu 45s.
                try:
                    sock.settimeout(max(45, ka * 2) if ka else 90)
                except OSError:
                    pass
                sock.sendall(bytes([0x20,0x02,0x00,0x00]))  # CONNACK ok
            elif typ==3:  # PUBLISH
                qos=(flags>>1)&3
                topic,i=rd_str(body,0)
                pid=None
                if qos>0:
                    pid=struct.unpack_from('>H',body,i)[0]; i+=2
                payload=body[i:]
                t=topic.decode(errors='replace')
                if ENUM_ON:  # 1 hook DUY NHẤT bắt MỌI message máy->server (đứng trước dispatch cũ)
                    try: catalog_observe('in', t, dec_json(payload), len(payload))
                    except Exception: catalog_observe('in', t, None, len(payload))
                if 'auth/login' in t:
                    log('  [PUB login] topic=%s qos=%d pid=%s dup=%d retain=%d'%(t,qos,pid,(flags>>3)&1,flags&1))
                    handle_auth_login(entry,t,payload)
                elif 'auth/encode' in t:
                    handle_auth_encode(t,payload)
                elif '/state' in t or 'state' in t.split('/'):
                    dev2=t.rsplit('/',1)[-1]
                    with open(STATE,'a') as f: f.write('%s %s\n'%(t,prettytxt(payload)))  # lưu base64 (script phân tích cũ vẫn giải mã được)
                    try:
                        b=dec_json(payload).get('body',{})
                        moc,delta=nhip_state(dev2,(b.get('state'),b.get('curStitch'),b.get('patternStitch'),b.get('patternName')))
                        log('*** STATE dev=%s cur=%s tot=%s state=%s pat=%s @%s Δ%s'%(dev2,b.get('curStitch'),b.get('patternStitch'),b.get('state'),b.get('patternName'),moc,delta))
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
                    # topic pattern khác (upload/send/…) — giải mã + log để soi định dạng máy gửi
                    try: log('  [pattern? %s] %s'%(t,json.dumps(dec_json(payload).get('body',{}),ensure_ascii=False)[:220]))
                    except Exception: log('  [pattern? %s] raw=%s'%(t,prettytxt(payload)[:80]))
                else:
                    log('PUBLISH %s  len=%d  %s'%(t,len(payload),prettytxt(payload)[:120]))
                if qos==1 and pid is not None:
                    sock.sendall(bytes([0x40,0x02])+struct.pack('>H',pid))  # PUBACK
                elif qos==2 and pid is not None:
                    sock.sendall(bytes([0x50,0x02])+struct.pack('>H',pid))  # PUBREC
            elif typ==6:  # PUBREL -> PUBCOMP (hoàn tất QoS2)
                pid=struct.unpack_from('>H',body,0)[0] if len(body)>=2 else 0
                sock.sendall(bytes([0x70,0x02])+struct.pack('>H',pid))  # PUBCOMP
            elif typ==8:  # SUBSCRIBE
                pid=struct.unpack_from('>H',body,0)[0]; i=2; rcodes=b''
                while i<len(body):
                    tp,i=rd_str(body,i); qos=body[i]; i+=1
                    subs.add(tp.decode(errors='replace')); rcodes+=bytes([qos])
                log('SUBSCRIBE', list(subs))
                sock.sendall(bytes([0x90])+enc_remlen(2+len(rcodes))+struct.pack('>H',pid)+rcodes)
            elif typ==12:  # PINGREQ
                sock.sendall(bytes([0xd0,0x00]))
            elif typ==14:  # DISCONNECT
                log('DISCONNECT', addr); break
            else:
                log('pkt type',typ,'rl',rl)
    except socket.timeout:
        # [V2] Day chinh la truong hop truoc kia treo vinh vien.
        log('== IM QUÁ LÂU, cắt kết nối', addr, 'dev=%s' % entry[2].get('dev'))
    except Exception as e:
        log('thread err',addr,e)
    finally:
        with lock:
            if entry in clients: clients.remove(entry)
        try: sock.close()
        except: pass
        log('== ĐÓNG', addr)

# ================== ENUMERATOR: catalog MỌI thông tin máy TỰ PHÁT (không cần người ở HMI) ==================
# Bắt mọi message máy->server (state/auth/pattern/unknown) + metadata CONNECT, gom thành:
#   - topics : mỗi topic đã thấy (chiều, số lần, min/max độ dài, giải mã được không)
#   - fields : mỗi key-path JSON (kiểu, ví dụ, min/max số, xuất hiện ở topic/state nào)
#   - states : union các field theo TỪNG giá trị trạng thái máy (bắt cả field chỉ hiện khi lỗi/đứt chỉ)
#   - connect: danh tính máy (clientId/proto/keepalive)
# Persist ra catalog.json + enum.log mỗi ~30s. CỘNG THÊM, KHÔNG đụng luồng state->bridge->dashboard.
ENUM_ON   = os.environ.get('ENUM_ENABLE','1') != '0'
CATALOG   = os.path.join(os.path.dirname(__file__),'catalog.json')
ENUM_LOG  = os.path.join(os.path.dirname(__file__),'enum.log')
# [A3] Chỉ-ghi-thêm: chuỗi thời gian độ phủ. CHỈ số đếm + mốc giờ, KHÔNG tên field, KHÔNG giá trị.
GROWTH    = os.path.join(os.path.dirname(__file__),'enum-growth.csv')
GROWTH_HEADER = 'ts,nTopics,nStates,nFields,newFieldsThisCycle'
_growth_prev = {'fields': 0}
_enum_lock = threading.Lock()
_enum = {'startedAt': None, 'topics': {}, 'fields': {}, 'states': {}, 'connect': {}}
# Field tên giống bí mật -> CHỈ ghi TÊN, không ghi giá trị/min-max (giữ bất biến an toàn: nonce auth cũng che).
_SECRET_HINT = ('secret','encode','key','iv','token','password','passwd','proof','credential')

def _is_secretish(keypath):
    kp=keypath.lower()
    return any(h in kp for h in _SECRET_HINT)

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
    # JSON lồng -> {"a.b.c": scalar}. List: ghi độ dài (a[]len) + mẫu phần tử đầu (a[]).
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
    # Nhãn trạng thái để gắn field: ưu tiên chuỗi mô tả, ngã về số.
    if not isinstance(body, dict): return 'n/a'
    for k in ('wstrStatusDesc', 'stateID', 'state'):
        if k in body and body[k] is not None:
            return '%s=%s' % (k, body[k])
    return 'n/a'

def catalog_observe(direction, topic, decoded, raw_len):
    """direction 'in'(máy->server)|'out'(server->máy). decoded: dict đã giải mã, hoặc None nếu không giải được."""
    if not ENUM_ON: return
    is_state = topic.endswith('state') or ('/state' in topic)
    with _enum_lock:
        if _enum['startedAt'] is None:
            _enum['startedAt'] = _iso()
        te = _enum['topics'].setdefault(topic, {'dir': direction, 'count': 0,
                                                 'firstSeen': _iso(), 'lastSeen': None,
                                                 'decodable': decoded is not None,
                                                 'minLen': raw_len, 'maxLen': raw_len})
        te['count'] += 1; te['lastSeen'] = _iso()
        if decoded is not None: te['decodable'] = True
        te['minLen'] = min(te['minLen'], raw_len); te['maxLen'] = max(te['maxLen'], raw_len)
        if decoded is None: return
        body = decoded.get('body', decoded) if isinstance(decoded, dict) else {}
        skey = _state_key(body)
        if is_state:
            _enum['states'].setdefault(skey, {'count': 0, 'keys': [], 'firstSeen': _iso()})
            _enum['states'][skey]['count'] += 1
        flat = {}
        _flatten('', decoded if isinstance(decoded, dict) else {'value': decoded}, flat)
        for kp, val in flat.items():
            fe = _enum['fields'].setdefault(kp, {'types': [], 'example': None, 'count': 0,
                                                 'states': [], 'topics': [], 'firstSeen': _iso(),
                                                 'numMin': None, 'numMax': None})
            fe['count'] += 1
            tn = _typename(val)
            if tn not in fe['types']: fe['types'].append(tn)
            if topic not in fe['topics']: fe['topics'].append(topic)
            if skey not in fe['states']: fe['states'].append(skey)
            if _is_secretish(kp):
                fe['example'] = '<redacted:name-only>'; fe['redacted'] = True
            else:
                if fe['example'] is None and not isinstance(val, (dict, list)):
                    fe['example'] = val
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    fe['numMin'] = val if fe['numMin'] is None else min(fe['numMin'], val)
                    fe['numMax'] = val if fe['numMax'] is None else max(fe['numMax'], val)
            if is_state:
                su = _enum['states'][skey]['keys']
                if kp not in su: su.append(kp)

def catalog_load():
    """[A2] Nạp catalog.json cũ (nếu có) TRƯỚC khi mở cổng, để restart không xoá sạch độ phủ.
    Gọi đúng một lần trong main(), trước khi có luồng nào ghi vào _enum."""
    if not ENUM_ON or not os.path.exists(CATALOG): return False
    try:
        with open(CATALOG) as f: old = json.load(f)
        if not isinstance(old, dict) or 'fields' not in old: raise ValueError('không đúng dạng catalog')
    except Exception as e:
        bad = CATALOG + '.bad'
        try: os.rename(CATALOG, bad); log('  [ENUM] catalog cũ hỏng (%s) -> giữ lại ở %s, bắt đầu lại từ rỗng' % (e, bad))
        except Exception: log('  [ENUM] catalog cũ hỏng (%s) và không đổi tên được; bắt đầu lại từ rỗng' % e)
        return False
    with _enum_lock:
        for k in ('topics', 'fields', 'states', 'connect'):
            _enum[k] = old.get(k) or {}
        _enum['startedAt'] = old.get('startedAt')     # giữ mốc lần chạy ĐẦU TIÊN
        _enum['sessions']  = old.get('sessions') or []
        # Catalog ghi trước A1 không có firstSeen -> để None. Không biết thì nói không biết.
        for fe in _enum['fields'].values():  fe.setdefault('firstSeen', None)
        for se in _enum['states'].values():  se.setdefault('firstSeen', None)
        _enum['sessions'].append({'startedAt': _iso(), 'pid': os.getpid()})
        _growth_prev['fields'] = len(_enum['fields'])   # restart không bị tính là "khám phá mới"
        n = (len(_enum['topics']), len(_enum['states']), len(_enum['fields']))
    log('  [ENUM] nạp lại catalog cũ: %d topic, %d state, %d field (lần chạy thứ %d)'
        % (n[0], n[1], n[2], len(_enum['sessions'])))
    return True

def catalog_dump():
    with _enum_lock:
        snap = json.loads(json.dumps(_enum))   # bản sao sâu, an toàn khi ghi ra ngoài lock
    try:
        with open(CATALOG, 'w') as f: json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
    except Exception as e:
        log('  [ENUM] ghi catalog lỗi: %s' % e)
    return snap

def catalog_report():
    snap = catalog_dump()
    lines = ['=== ENUM REPORT %s (bắt đầu %s) ===' % (_iso(), snap.get('startedAt'))]
    lines.append('Topic đã thấy: %d' % len(snap['topics']))
    for t, te in sorted(snap['topics'].items()):
        lines.append('  %-52s dir=%s n=%d len=%d..%d decodable=%s'
                     % (t, te['dir'], te['count'], te['minLen'], te['maxLen'], te['decodable']))
    lines.append('Trạng thái máy đã thấy: %d' % len(snap['states']))
    for s, se in sorted(snap['states'].items()):
        lines.append('  %-28s n=%d  #field=%d' % (s, se['count'], len(se['keys'])))
    lines.append('Tổng field riêng biệt: %d' % len(snap['fields']))
    for kp in sorted(snap['fields']):
        fe = snap['fields'][kp]
        rng = '' if fe.get('numMin') is None else ' range=[%s..%s]' % (fe['numMin'], fe['numMax'])
        lines.append('  %-42s types=%s ex=%r n=%d%s' % (kp, '/'.join(fe['types']), fe['example'], fe['count'], rng))
    txt = '\n'.join(lines) + '\n'
    try:
        with open(ENUM_LOG, 'w') as f: f.write(txt)
    except Exception as e:
        log('  [ENUM] ghi enum.log lỗi: %s' % e)
    nf = len(snap['fields'])
    new = nf - _growth_prev['fields']
    _growth_prev['fields'] = nf
    try:
        fresh = not os.path.exists(GROWTH)
        with open(GROWTH, 'a') as f:
            if fresh: f.write(GROWTH_HEADER + '\n')
            f.write('%s,%d,%d,%d,%d\n' % (_iso(), len(snap['topics']), len(snap['states']), nf, new))
    except Exception as e:
        log('  [ENUM] ghi enum-growth.csv lỗi: %s' % e)
    log('  [ENUM] report: %d topic, %d state, %d field (+%d field mới chu kỳ này)'
        % (len(snap['topics']), len(snap['states']), nf, new))
    return snap

def catalog_writer():
    while True:
        try: catalog_report()
        except Exception as e: log('  [ENUM] writer lỗi: %s' % e)
        time.sleep(30)

def main():
    _xoay_log()
    load_patterns()
    threading.Thread(target=ctrl_watcher,daemon=True).start()
    if ENUM_ON:
        catalog_load()
        threading.Thread(target=catalog_writer,daemon=True).start()
        log('  [ENUM] enumerator BẬT -> %s + %s + %s'%(CATALOG,ENUM_LOG,GROWTH))
    srv=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    srv.bind((HOST,PORT)); srv.listen(16)
    log('Broker lắng nghe %s:%d  (KEY/IV/A/B nạp sẵn, XXTEA)'%(HOST,PORT))
    while True:
        c,a=srv.accept()
        threading.Thread(target=client_thread,args=(c,a),daemon=True).start()

if __name__=='__main__':
    main()
