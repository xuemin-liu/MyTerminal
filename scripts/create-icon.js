#!/usr/bin/env node
// Generates build/icon.ico — a terminal ">_" icon in app colours.
// Run once: node scripts/create-icon.js
'use strict'

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

// ── App colours ──────────────────────────────────────────────────────────────
const BG = [13,  17,  23 ]   // #0d1117 — terminal background
const FG = [88,  166, 255]   // #58a6ff — accent blue

// ── CRC-32 (required for PNG chunks) ─────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[n] = c
}
function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ── PNG encoder ───────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb  = Buffer.from(type)
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([len, tb, data, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8-bit RGBA

  const raw = Buffer.alloc(size * (1 + size * 4))
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0  // filter: None
    for (let x = 0; x < size; x++) {
      const pi = (y * size + x) * 4
      const ri = y * (1 + size * 4) + 1 + x * 4
      raw[ri] = rgba[pi]; raw[ri+1] = rgba[pi+1]; raw[ri+2] = rgba[pi+2]; raw[ri+3] = rgba[pi+3]
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Drawing canvas ────────────────────────────────────────────────────────────
function makeCanvas(size) {
  const buf = new Uint8Array(size * size * 4)

  const set = (x, y, r, g, b, a = 255) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a
  }

  const circle = (cx, cy, rad, r, g, b) => {
    const r2 = rad * rad
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++)
        if (dx*dx + dy*dy <= r2) set(cx+dx, cy+dy, r, g, b)
  }

  const line = (x0, y0, x1, y1, r, g, b, thick) => {
    const dx = x1 - x0, dy = y1 - y0
    const steps = Math.ceil(Math.sqrt(dx*dx + dy*dy)) * 2
    const rad = Math.max(1, Math.floor(thick / 2))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      circle(x0 + dx * t, y0 + dy * t, rad, r, g, b)
    }
  }

  const rect = (x, y, w, h, r, g, b) => {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++)
        set(x + dx, y + dy, r, g, b)
  }

  return { buf, set, line, rect }
}

// ── Downscale with box filter (for antialiased small sizes) ──────────────────
function downscale(src, srcSize, dstSize) {
  const dst = new Uint8Array(dstSize * dstSize * 4)
  const ratio = srcSize / dstSize
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      const sx0 = Math.floor(x * ratio), sy0 = Math.floor(y * ratio)
      const sx1 = Math.ceil((x + 1) * ratio), sy1 = Math.ceil((y + 1) * ratio)
      for (let sy = sy0; sy < Math.min(sy1, srcSize); sy++)
        for (let sx = sx0; sx < Math.min(sx1, srcSize); sx++) {
          const i = (sy * srcSize + sx) * 4
          r += src[i]; g += src[i+1]; b += src[i+2]; a += src[i+3]; n++
        }
      const di = (y * dstSize + x) * 4
      dst[di] = r/n; dst[di+1] = g/n; dst[di+2] = b/n; dst[di+3] = a/n
    }
  }
  return dst
}

// ── Icon drawing (coordinates relative to 256×256) ───────────────────────────
function drawIcon256() {
  const size = 256
  const { buf, set, line, rect } = makeCanvas(size)

  // Fill background
  for (let i = 0; i < size * size; i++) {
    buf[i*4] = BG[0]; buf[i*4+1] = BG[1]; buf[i*4+2] = BG[2]; buf[i*4+3] = 255
  }

  // Rounded corners (radius 32)
  const cr = 32
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ox = 0, oy = 0, inCorner = false
      if      (x < cr && y < cr)              { ox = cr - x - 1; oy = cr - y - 1; inCorner = true }
      else if (x >= size - cr && y < cr)      { ox = x - (size - cr); oy = cr - y - 1; inCorner = true }
      else if (x < cr && y >= size - cr)      { ox = cr - x - 1; oy = y - (size - cr); inCorner = true }
      else if (x >= size - cr && y >= size - cr) { ox = x - (size - cr); oy = y - (size - cr); inCorner = true }
      if (inCorner && ox*ox + oy*oy > cr*cr) set(x, y, 0, 0, 0, 0)
    }
  }

  // Subtle inner glow border (1px, slightly lighter)
  const BORDER = [30, 40, 55]
  for (let i = 0; i < size; i++) {
    set(i, 0, BORDER[0], BORDER[1], BORDER[2])
    set(i, size-1, BORDER[0], BORDER[1], BORDER[2])
    set(0, i, BORDER[0], BORDER[1], BORDER[2])
    set(size-1, i, BORDER[0], BORDER[1], BORDER[2])
  }

  const thick = 20  // stroke thickness in px at 256×256

  // ">" — two arms meeting at the right tip
  // Top arm: (30, 58) → (115, 128)
  // Bottom arm: (115, 128) → (30, 198)
  line(30, 58,  115, 128, FG[0], FG[1], FG[2], thick)
  line(115, 128, 30, 198, FG[0], FG[1], FG[2], thick)

  // "_" — horizontal bar in the right half, near the baseline
  const ux = 138, uy = 190, uw = 92, uh = 16
  rect(ux, uy, uw, uh, FG[0], FG[1], FG[2])

  return buf
}

// ── ICO builder ───────────────────────────────────────────────────────────────
function buildIco(sizes) {
  const master = drawIcon256()
  const pngs = sizes.map(s =>
    encodePng(s, s === 256 ? master : downscale(master, 256, s))
  )

  // 6-byte ICONDIR header
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)           // reserved
  header.writeUInt16LE(1, 2)           // type: icon
  header.writeUInt16LE(sizes.length, 4)

  // 16-byte ICONDIRENTRY per image
  let offset = 6 + sizes.length * 16
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16)
    e[0] = s >= 256 ? 0 : s  // width  (0 = 256)
    e[1] = s >= 256 ? 0 : s  // height (0 = 256)
    e[2] = 0                  // colorCount
    e[3] = 0                  // reserved
    e.writeUInt16LE(1, 4)     // planes
    e.writeUInt16LE(32, 6)    // bitCount
    e.writeUInt32LE(pngs[i].length, 8)
    e.writeUInt32LE(offset, 12)
    offset += pngs[i].length
    return e
  })

  return Buffer.concat([header, ...entries, ...pngs])
}

// ── Write file ────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '../build/icon.ico')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, buildIco([256, 48, 32, 16]))
console.log('✓ Icon written to', outPath)
