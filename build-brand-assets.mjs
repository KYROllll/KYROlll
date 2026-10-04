// Rebuild email-friendly raster versions of the editable SVG brand artwork.
import sharp from "sharp";

const assets = new URL("./assets/", import.meta.url);
await sharp(new URL("kyrolll-flower.svg", assets).pathname, { density: 192 })
  .resize(640, 640)
  .flatten({ background: "#f4f1ea" })
  .jpeg({ quality: 92, mozjpeg: true })
  .toFile(new URL("kyrolll-flower.jpg", assets).pathname);

await sharp(new URL("kyrolll-doodles.svg", assets).pathname, { density: 144 })
  .resize(1200, 152, { fit: "cover", position: "top" })
  .flatten({ background: "#1c1b18" })
  .png()
  .toFile(new URL("kyrolll-email-doodles.png", assets).pathname);

console.log("Built KYROlll flower JPEG and email doodle PNG.");
