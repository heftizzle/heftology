// sharp@0.35.5
// Run once from the repo root, not during deploy:
//   npx -y -p sharp@0.35.5 node scripts/optimize-images.js
// Writes a .webp sibling and replaces the original JPEG or PNG with a resized
// fallback. Skips a file when its .webp already exists and it is already within
// the target box, so a second run does not recompress it.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const IMAGES = path.join(ROOT, "images");

function box(width, height) {
  return { width, height, fit: "inside", withoutEnlargement: true };
}

const JOBS = [
  { file: "heftology-logo.png", resize: box(1200, 1200) },
  { file: "heftology-logo-nav.png", resize: box(320, 320) },
  { file: "carissa-headshot_hsthumb.png", resize: box(400, 400), alsoJpeg: true },
  { file: "michelle-headshot_hsthumb.jpg", resize: box(400, 400) },
  { file: "team-mud-girl.jpg", resize: box(1200, 10000) },
  { file: "team-cheers.jpg", resize: box(1200, 760) },
  { file: "team-craft.jpg", resize: box(1200, 760) },
];

for (let n = 1; n <= 26; n++) {
  const name = `gallery-${String(n).padStart(2, "0")}.jpg`;
  JOBS.push({ file: path.join("gallery", name), resize: box(1200, 760) });
}

async function writeEncoded(pipeline, dest, format) {
  if (format === "png") {
    await pipeline.clone().png({ compressionLevel: 9 }).toFile(dest + ".tmp");
  } else if (format === "webp") {
    await pipeline.clone().webp({ quality: 75 }).toFile(dest + ".tmp");
  } else {
    await pipeline.clone().jpeg({ quality: 76, mozjpeg: true }).toFile(dest + ".tmp");
  }
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(dest + ".tmp", dest);
}

async function optimizeOne(job) {
  const src = path.join(IMAGES, job.file);
  const ext = path.extname(src).slice(1).toLowerCase();
  const format = ext === "jpeg" ? "jpg" : ext;
  const webp = src.replace(/\.(png|jpe?g)$/i, ".webp");
  const meta = await sharp(src).metadata();
  const within = meta.width <= job.resize.width && meta.height <= job.resize.height;
  if (within && fs.existsSync(webp)) {
    console.log(`skip ${job.file} ${meta.width}x${meta.height}`);
    return;
  }
  const pipeline = sharp(src).rotate().resize(job.resize);
  await writeEncoded(pipeline, webp, "webp");
  await writeEncoded(sharp(src).rotate().resize(job.resize), src, format);
  if (job.alsoJpeg) {
    const jpg = src.replace(/\.png$/i, ".jpg");
    await writeEncoded(sharp(src).rotate().resize(job.resize), jpg, "jpg");
  }
  const after = await sharp(src).metadata();
  const webpBytes = fs.statSync(webp).size;
  console.log(`${job.file} ${meta.width}x${meta.height} -> ${after.width}x${after.height} webp ${webpBytes}`);
}

async function shareImage() {
  const src = path.join(IMAGES, "team-cheers.jpg");
  const dest = path.join(IMAGES, "og-share.jpg");
  let quality = 74;
  let bytes = Infinity;
  while (quality >= 40 && bytes > 300 * 1024) {
    await sharp(src)
      .rotate()
      .resize(1200, 630, { fit: "cover", position: "centre" })
      .jpeg({ quality, mozjpeg: true })
      .toFile(dest + ".tmp");
    bytes = fs.statSync(dest + ".tmp").size;
    if (bytes > 300 * 1024) quality -= 8;
  }
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(dest + ".tmp", dest);
  console.log(`og-share.jpg 1200x630 ${bytes} bytes q${quality}`);
}

async function favicons() {
  const src = path.join(IMAGES, "heftology-icon.png");
  const sizes = [
    ["favicon-32.png", 32],
    ["apple-touch-icon.png", 180],
  ];
  for (const [name, size] of sizes) {
    const dest = path.join(IMAGES, name);
    await sharp(src)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(dest + ".tmp");
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(dest + ".tmp", dest);
    console.log(`${name} ${size}x${size} ${fs.statSync(dest).size}`);
  }
}

(async () => {
  await shareImage();
  await favicons();
  for (const job of JOBS) await optimizeOne(job);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
