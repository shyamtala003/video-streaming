import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { workerData, parentPort } from "worker_threads";

const { jobId, file } = workerData;
const TARGET_HEIGHTS = [2160, 1080, 720, 360, 240];
const HLS_BANDWIDTH = {
  2160: 14000000,
  1080: 6000000,
  720: 2800000,
  360: 900000,
  240: 500000,
};
const HLS_MAXRATE_K = {
  2160: 12000,
  1080: 5000,
  720: 2800,
  360: 900,
  240: 500,
};

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}: ${(stderr || stdout || "").trim()}`,
        ),
      );
    });
  });

const probeVideo = async (input) => {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "json",
    input,
  ]);

  const parsed = JSON.parse(stdout);
  const stream = parsed?.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);

  if (!width || !height) {
    throw new Error("Unable to read source resolution from ffprobe.");
  }

  return { width, height };
};

const even = (n) => {
  const rounded = Math.round(n);
  return rounded % 2 === 0 ? rounded : rounded - 1;
};

const pickRenditionHeights = (sourceHeight) => {
  const picked = TARGET_HEIGHTS.filter((h) => h <= sourceHeight);
  if (picked.length > 0) return picked;
  // Very small source: keep one rendition at source size (no upscaling).
  return [Math.max(2, even(sourceHeight))];
};

const buildFilterComplex = (heights) => {
  const splitOutputs = heights.map((_, i) => `[v${i}]`).join("");
  const parts = [`[0:v]split=${heights.length}${splitOutputs}`];

  heights.forEach((height, i) => {
    // Keep aspect ratio and force even width for codec compatibility.
    parts.push(`[v${i}]scale=-2:${height}[v${i}out]`);
  });

  return parts.join(";");
};

const buildFfmpegArgs = (input, outputDir, heights) => {
  const args = ["-y", "-i", input, "-filter_complex", buildFilterComplex(heights)];

  heights.forEach((height, i) => {
    const maxrateK = HLS_MAXRATE_K[height] || Math.max(600, height * 2);
    const bufsizeK = maxrateK * 2;

    args.push(
      "-map",
      `[v${i}out]`,
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-maxrate",
      `${maxrateK}k`,
      "-bufsize",
      `${bufsizeK}k`,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "hls",
      "-hls_time",
      "6",
      "-hls_playlist_type",
      "vod",
      path.join(outputDir, `${height}p.m3u8`),
    );
  });

  return args;
};

const writeMasterPlaylist = async (outputDir, sourceWidth, sourceHeight, heights) => {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  const aspectRatio = sourceWidth / sourceHeight;

  heights.forEach((height) => {
    const width = even(height * aspectRatio);
    const bandwidth = HLS_BANDWIDTH[height] || Math.max(500000, width * height);

    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${width}x${height}`,
    );
    lines.push(`${height}p.m3u8`);
  });

  await fs.writeFile(path.join(outputDir, "master.m3u8"), `${lines.join("\n")}\n`);
};

const run = async () => {
  const input = path.resolve(process.cwd(), "storage/originals", file);
  const outputDir = path.resolve(process.cwd(), "storage/hls", file);
  const source = await probeVideo(input);
  const heights = pickRenditionHeights(source.height);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  console.log(
    `[worker] job=${jobId} source=${source.width}x${source.height} renditions=${heights
      .map((h) => `${h}p`)
      .join(",")}`,
  );

  await runCommand("ffmpeg", buildFfmpegArgs(input, outputDir, heights));
  await writeMasterPlaylist(outputDir, source.width, source.height, heights);
};

run()
  .then(() => parentPort?.postMessage({ type: "completed", jobId }))
  .catch((err) =>
    parentPort?.postMessage({
      type: "failed",
      jobId,
      reason: err.message,
    }),
  );
