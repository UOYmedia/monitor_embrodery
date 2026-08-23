#!/usr/bin/env node
/** Đọc enum-growth.csv của enumerator và nói ra đã bão hoà chưa. Mặc định đọc trên Mini. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { docCsv, phanTich } from './lib/growth-curve.mjs'

const duong = process.argv[2] ?? join(homedir(), 'dahao-gateway', 'enum-growth.csv')
const hang = docCsv(readFileSync(duong, 'utf8'))
const k = phanTich(hang)

console.log(`Nguồn        : ${duong}`)
console.log(`Chu kỳ       : ${k.soChuKy}${k.phutChay === null ? '' : `  (~${k.phutChay.toFixed(0)} phút)`}`)
console.log(`Field / State: ${k.tongField} field, ${k.soState} trạng thái`)
console.log(`Chu kỳ sạch  : ${k.chuKySach}`)
console.log(`Kết luận     : ${k.ketLuan}`)
