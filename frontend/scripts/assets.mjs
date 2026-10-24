import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const font = new URL("static/fonts/PretendardVariable-1.3.9.woff2", root);
let data;
try {
  data = await readFile(font);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const response = await fetch(
    "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`Font download failed: ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (
  data.subarray(0, 4).toString() !== "wOF2" ||
  createHash("sha256").update(data).digest("hex") !==
    "9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4"
) {
  throw new Error("Pretendard font integrity check failed");
}
await mkdir(new URL("static/fonts/", root), { recursive: true });
await writeFile(font, data);
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await copyFile(
  new URL("static/fonts/OFL.txt", root),
  new URL("../public/OFL.txt", import.meta.url),
);
