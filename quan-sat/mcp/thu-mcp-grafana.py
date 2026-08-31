#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Chạy thật mcp-grafana qua stdio: bắt tay, liệt kê công cụ, rồi HỎI THẬT một câu LogQL.

Liệt kê được công cụ chưa chứng minh gì — phải gọi một công cụ có đi tới Grafana và trả về số liệu
của xưởng thì mới chắc token và đường mạng đều thông.
"""
import json
import os
import subprocess
import sys

BIN = '/opt/homebrew/bin/mcp-grafana'
moi = dict(os.environ)
for d in open('/Users/phong/dahao-gateway/quan-sat/mcp-grafana.env'):
    d = d.strip()
    if '=' in d and not d.startswith('#'):
        k, v = d.split('=', 1)
        moi[k] = v

p = subprocess.Popen([BIN, '-t', 'stdio'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE, text=True, env=moi, bufsize=1)


def goi(mid, method, params=None, cho=True):
    g = {'jsonrpc': '2.0', 'method': method}
    if mid is not None:
        g['id'] = mid
    if params is not None:
        g['params'] = params
    p.stdin.write(json.dumps(g) + '\n')
    p.stdin.flush()
    if not cho:
        return None
    while True:
        d = p.stdout.readline()
        if not d:
            raise SystemExit('!! mcp-grafana dong som. stderr:\n' + p.stderr.read()[:2000])
        try:
            o = json.loads(d)
        except ValueError:
            continue
        if o.get('id') == mid:
            return o


r = goi(1, 'initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                          'clientInfo': {'name': 'thu', 'version': '0'}})
si = r['result']['serverInfo']
print('bat tay OK: %s %s' % (si.get('name'), si.get('version')))
goi(None, 'notifications/initialized', {}, cho=False)

r = goi(2, 'tools/list', {})
ds = [t['name'] for t in r['result']['tools']]
print('so cong cu: %d' % len(ds))
print('   ', ', '.join(ds))

# --- gọi thật ---
r = goi(3, 'tools/call', {'name': 'list_datasources', 'arguments': {}})
print('\nlist_datasources ->', json.dumps(r.get('result', r), ensure_ascii=False)[:300])

cau = ('sum by (tinh_trang) (count_over_time({job="tinh-trang"} | json '
       '| tinh_trang != "" [5m]))')
ten = 'query_loki_logs' if 'query_loki_logs' in ds else None
for t in ds:
    if 'loki' in t and 'label' in t and 'name' in t:
        r = goi(4, 'tools/call', {'name': t, 'arguments': {'datasourceUid': 'loki-dahao'}})
        print('\n%s ->' % t, json.dumps(r.get('result', r), ensure_ascii=False)[:400])
        break
if ten:
    r = goi(5, 'tools/call', {'name': ten, 'arguments': {
        'datasourceUid': 'loki-dahao', 'logql': '{job="tinh-trang"}', 'limit': 3}})
    print('\n%s ->' % ten, json.dumps(r.get('result', r), ensure_ascii=False)[:600])

p.stdin.close()
p.terminate()
