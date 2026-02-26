import os from "os";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Worker } from "worker_threads";

const maxParallel = Math.max(1, Math.min(4, os.availableParallelism() || 1));
const jobs = new Map();
const pending = [];

let activeWorkers = 0;

export const queueEvents = new EventEmitter();

const toJobResponse = (job) => ({
  id: job.id,
  name: job.name,
  data: job.data,
});

const processNext = () => {
  while (activeWorkers < maxParallel && pending.length > 0) {
    const jobId = pending.shift();
    const job = jobs.get(jobId);
    if (!job || job.state !== "waiting") continue;

    activeWorkers += 1;
    job.state = "active";
    job.progress = 10;
    job.processedOn = Date.now();
    queueEvents.emit("active", { jobId: job.id });

    const worker = new Worker(new URL("./transcode.worker.js", import.meta.url), {
      workerData: { jobId: job.id, file: job.data.file },
    });

    worker.on("message", (msg) => {
      if (!msg || msg.jobId !== job.id) return;

      if (msg.type === "completed") {
        job.state = "completed";
        job.progress = 100;
        job.finishedOn = Date.now();
        queueEvents.emit("completed", { jobId: job.id });
      }

      if (msg.type === "failed") {
        job.state = "failed";
        job.failedReason = msg.reason || "Unknown worker error";
        job.finishedOn = Date.now();
        queueEvents.emit("failed", { jobId: job.id, failedReason: job.failedReason });
      }
    });

    worker.on("error", (err) => {
      job.state = "failed";
      job.failedReason = err.message;
      job.finishedOn = Date.now();
      queueEvents.emit("failed", { jobId: job.id, failedReason: err.message });
      queueEvents.emit("error", err);
    });

    worker.on("exit", () => {
      activeWorkers = Math.max(0, activeWorkers - 1);
      processNext();
    });
  }
};

const videoQueue = {
  async add(name, data) {
    const job = {
      id: randomUUID(),
      name,
      data,
      state: "waiting",
      progress: 0,
      failedReason: null,
      processedOn: null,
      finishedOn: null,
    };

    jobs.set(job.id, job);
    pending.push(job.id);
    processNext();

    return toJobResponse(job);
  },

  async getJob(id) {
    return jobs.get(id) || null;
  },
};

export default videoQueue;
