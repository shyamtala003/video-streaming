import { Worker } from "bullmq";
import { exec } from "child_process";
import fs from "fs/promises";

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};

const execAsync = (command) =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });

const worker = new Worker(
  "video-processing",
  async (job) => {
    const input = `storage/originals/${job.data.file}`;
    const outputDir = `storage/hls/${job.data.file}`;

    await fs.mkdir(outputDir, { recursive: true });
    console.log(`[worker] started job=${job.id} file=${job.data.file}`);

    const cmd = `
    ffmpeg -i ${input} \
    -filter_complex \
    "[0:v]split=3[v1][v2][v3];
    [v1]scale=426:240[v1out];
    [v2]scale=640:360[v2out];
    [v3]scale=1280:720[v3out]" \
    -map "[v1out]" -map 0:a? -f hls -hls_time 6 -hls_playlist_type vod ${outputDir}/240p.m3u8 \
    -map "[v2out]" -map 0:a? -f hls -hls_time 6 -hls_playlist_type vod ${outputDir}/360p.m3u8 \
    -map "[v3out]" -map 0:a? -f hls -hls_time 6 -hls_playlist_type vod ${outputDir}/720p.m3u8
    `;

    await execAsync(cmd);
    console.log(`[worker] completed job=${job.id} file=${job.data.file}`);
  },
  { connection },
);

worker.on("failed", (job, err) => {
  console.error(
    `[worker] failed job=${job?.id} file=${job?.data?.file} reason=${err.message}`,
  );
});

worker.on("error", (err) => {
  console.error(`[worker] queue error: ${err.message}`);
});
