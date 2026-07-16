import { tick } from './tick.js';

/** Dev daemon: run the worker cycle every 5 minutes (hourly work is idempotent). */
const INTERVAL_MS = 5 * 60e3;

console.log('rook workers: ticking every 5m');
const loop = async () => {
  const now = new Date();
  try {
    await tick(now);
    console.log(`${now.toISOString()} tick ok`);
  } catch (err) {
    console.error(`${now.toISOString()} tick failed`, err);
  }
};
await loop();
setInterval(loop, INTERVAL_MS);
