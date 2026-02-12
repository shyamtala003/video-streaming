import express from "express";
import { QueueEvents } from "bullmq";
import upload from "./api/upload.controller.js";
import videoQueue, { connection } from "./workers/queue.js";
import cors from "cors";
import "./workers/transcoder.js";

const app = express();
const queueEvents = new QueueEvents("video-processing", { connection });

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

  const state = await job.getState();
  res.json({
    id: job.id,
    name: job.name,
    state,
    progress: job.progress,
    data: job.data,
    failedReason: job.failedReason || null,
    finishedOn: job.finishedOn || null,
    processedOn: job.processedOn || null,
  });
});

app.use("/videos", express.static("storage/hls"));

app.listen(5000);
