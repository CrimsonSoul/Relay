/**
* Enhanced Cross-Process File Locking Test
* 
* This script verifies that our production modifyJsonWithLock implementation
* correctly handles concurrent updates from multiple processes.
*/

import { fork } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { existsSync } from "fs";
import { modifyJsonWithLock } from "../../src/main/fileLock";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, "../../data");
const TEST_FILE = join(DATA_DIR, "concurrency-test.json");
const NUM_PROCESSES = 8;
const WRITES_PER_PROCESS = 25;

async function runWorker(processId: number): Promise<void> {
  console.log(`[Process ${processId}] Starting ${WRITES_PER_PROCESS} updates...`);
  
  for (let i = 0; i < WRITES_PER_PROCESS; i++) {
    await modifyJsonWithLock<{ counter: number; writes: any[] }>(
      TEST_FILE,
      async (data) => {
        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
        
        data.counter++;
        data.writes.push({ process: processId, time: Date.now() });
        return data;
      },
      { counter: 0, writes: [] }
    );
    if (i % 5 === 0) process.stdout.write(`${processId}`);
  }
}

async function runTest(): Promise<void> {
  const isWorker = process.argv.includes("--worker");

  if (isWorker) {
    const processId = parseInt(process.argv[process.argv.indexOf("--worker") + 1], 10);
    await runWorker(processId);
    process.exit(0);
  }

  // Ensure data dir exists
  if (!existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });

  // Clean start - ONLY in master
  if (existsSync(TEST_FILE)) await fs.unlink(TEST_FILE);
  if (existsSync(`${TEST_FILE}.lock`)) {
    try {
      await fs.rm(`${TEST_FILE}.lock`, { recursive: true, force: true });
    } catch (e) {
      console.warn("Could not remove old lock file, may be held by another process");
    }
  }

  console.log("=".repeat(50));
  console.log("Cross-Process Concurrency Test");
  console.log(`Processes: ${NUM_PROCESSES}, Writes/Process: ${WRITES_PER_PROCESS}`);
  console.log("=".repeat(50));

  const workers: Promise<void>[] = [];
  
  for (let i = 0; i < NUM_PROCESSES; i++) {
    workers.push(new Promise((resolve, reject) => {
      const child = fork(__filename, ["--worker", String(i)], { stdio: "inherit" });
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
    }));
  }

  await Promise.all(workers);

  const finalData = JSON.parse(await fs.readFile(TEST_FILE, "utf-8"));
  const expected = NUM_PROCESSES * WRITES_PER_PROCESS;
  
  console.log("\n" + "=".repeat(50));
  console.log(`Final Counter: ${finalData.counter}`);
  console.log(`Expected:      ${expected}`);
  console.log("=".repeat(50));

  if (finalData.counter === expected) {
    console.log("SUCCESS: All updates preserved!");
    process.exit(0);
  } else {
    console.log("FAILURE: Lost updates detected!");
    process.exit(1);
  }
}

runTest().catch(console.error);
