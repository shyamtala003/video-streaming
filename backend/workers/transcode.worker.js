import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import { workerData, parentPort } from "worker_threads";

const { jobId, file } = workerData;

const run = async () => {
  const input = path.resolve(process.cwd(), "storage/originals", file);
  const outputDir = path.resolve(process.cwd(), "storage/hls", file);

  await fs.mkdir(outputDir, { recursive: true });

  const args = [
    "-i",
    input,
    "-filter_complex",
    "[0:v]split=3[v1][v2][v3];[v1]scale=426:240[v1out];[v2]scale=640:360[v2out];[v3]scale=1280:720[v3out]",
    "-map",
    "[v1out]",
    "-map",
    "0:a?",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    path.join(outputDir, "240p.m3u8"),
    "-map",
    "[v2out]",
    "-map",
    "0:a?",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    path.join(outputDir, "360p.m3u8"),
    "-map",
    "[v3out]",
    "-map",
    "0:a?",
    "-f",
    "hls",
    "-hls_time",
    "6",
    "-hls_playlist_type",
    "vod",
    path.join(outputDir, "720p.m3u8"),
  ];

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args);
    let errorText = "";

    ffmpeg.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText || `ffmpeg exited with code ${code}`));
    });
  });
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
