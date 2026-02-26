import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import upload from "./api/upload.controller.js";
import videoQueue, { queueEvents } from "./workers/queue.js";
import cors from "cors";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../frontend");

app.use(cors({ origin: "*" }));

queueEvents.on("active", ({ jobId }) => {
  console.log(`[queue] active job=${jobId}`);
});

queueEvents.on("completed", ({ jobId }) => {
  console.log(`[queue] completed job=${jobId}`);
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`[queue] failed job=${jobId} reason=${failedReason}`);
});

queueEvents.on("error", (err) => {
  console.error(`[queue] error: ${err.message}`);
});

app.post("/upload", upload.single("video"), async (req, res) => {
  const job = await videoQueue.add("transcode", {
    file: req.file.filename,
  });

  console.log(`[api] queued job=${job.id} file=${req.file.filename}`);
  res.json({
    message: "Processing started",
    jobId: job.id,
    file: req.file.filename,
  });
});

app.get("/jobs/:id", async (req, res) => {
  const job = await videoQueue.getJob(req.params.id);
  if (!job) {
    res.status(404).json({ message: "Job not found" });
    return;
  }

  res.json({
    id: job.id,
    name: job.name,
    state: job.state,
    progress: job.progress,
    data: job.data,
    failedReason: job.failedReason || null,
    finishedOn: job.finishedOn || null,
    processedOn: job.processedOn || null,
  });
});

app.use("/videos/stream", express.static("storage/hls"));
app.use("/videos/static", express.static("storage/originals"));
app.use("/frontend", express.static(frontendDir));

app.get("/player", (req, res) => {
  res.sendFile(path.join(frontendDir, "embed.html"));
});

app.listen(5000);
