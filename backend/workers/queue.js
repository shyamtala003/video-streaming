import { Queue } from "bullmq";
export const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT || 6379),
};

const videoQueue = new Queue("video-processing", { connection });

export default videoQueue;
