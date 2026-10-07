// 从 public/icons 的 SVG 生成 PWA/桌面所需的全部位图图标
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const iconsDir = "D:/graduate ast/public/icons";
const svgAny = fs.readFileSync(path.join(iconsDir, "icon.svg"));
const svgMask = fs.readFileSync(path.join(iconsDir, "icon-maskable.svg"));

async function renderPng(svg, size, out) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(out);
  const meta = await sharp(out).metadata();
  console.log(path.basename(out), meta.width + "x" + meta.height, "alpha:", meta.hasAlpha);
}

(async () => {
  await renderPng(svgAny, 512, path.join(iconsDir, "icon-512.png"));
  await renderPng(svgAny, 192, path.join(iconsDir, "icon-192.png"));
  await renderPng(svgMask, 512, path.join(iconsDir, "icon-maskable-512.png"));
  await renderPng(svgMask, 180, path.join(iconsDir, "apple-touch-icon.png"));

  // favicon.ico：16/32/48 三档 PNG 打包进 ICO 容器
  const sizes = [16, 32, 48];
  const pngs = [];
  for (const s of sizes) {
    const buf = await sharp(svgAny, { density: 300 }).resize(s, s).png().toBuffer();
    pngs.push({ s, buf });
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon type
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { s, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4);  // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  const ico = Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]);
  fs.writeFileSync("D:/graduate ast/public/favicon.ico", ico);
  console.log("favicon.ico", ico.length, "bytes");
})().catch(err => { console.error(err); process.exit(1); });
