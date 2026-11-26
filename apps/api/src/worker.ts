import 'dotenv/config';
import { processTransferJob } from './services/consistencyEngine.js';
import { pool } from './services/database.js';

const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);

async function processPendingJobs(): Promise<void> {
  const jobs = await pool.query(
    `WITH claimed AS (
       SELECT id FROM transfer_jobs
       WHERE status = 'pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 10
     )
     UPDATE transfer_jobs AS jobs
     SET status = 'processing', updated_at = NOW()
     FROM claimed
     WHERE jobs.id = claimed.id
     RETURNING jobs.id`
  );
  for (const job of jobs.rows) {
    try {
      await processTransferJob(job.id);
    } catch (error) {
      console.error('TRANSFER_WORKER_JOB_ERROR', { jobId: job.id, error });
    }
  }
}

let stopping = false;
const stop = async () => {
  stopping = true;
  await pool.end();
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

async function run(): Promise<void> {
  while (!stopping) {
    try {
      await processPendingJobs();
    } catch (error) {
      console.error('TRANSFER_WORKER_POLL_ERROR', error);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

void run();
