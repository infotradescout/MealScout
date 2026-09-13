import assert from "node:assert/strict";
import test from "node:test";

const until=async(predicate:()=>boolean,deadlineMs=4000)=>{
  const deadline=Date.now()+deadlineMs;
  while(!predicate()) {if(Date.now()>deadline)throw new Error("Queue did not settle in time");await new Promise(resolve=>setTimeout(resolve,20));}
};

test("queue owns timed-out work until settled and retries ordinary dependency timeouts", async()=>{
  process.env.JOB_QUEUE_RETRY_BASE_MS="250";process.env.JOB_QUEUE_RETRY_MAX_MS="250";
  const {enqueueInProcessJob,getJobQueueStats}=await import("../server/jobs/jobQueue");
  let runs=0;let release!:()=>void;
  const slow=new Promise<void>(resolve=>{release=resolve;});
  enqueueInProcessJob("audit-slow",async()=>{runs++;await slow;},{timeoutMs:1000,maxAttempts:3});
  await until(()=>getJobQueueStats().totals.timedOut===1);
  assert.equal(runs,1);assert.equal(getJobQueueStats().active,1);assert.equal(getJobQueueStats().totals.retried,0);
  release();await until(()=>getJobQueueStats().active===0);
  assert.equal(getJobQueueStats().totals.completed,1);
  let attempts=0;
  enqueueInProcessJob("audit-dependency",async()=>{if(++attempts===1)throw new Error("remote request timed out");},{timeoutMs:1000,maxAttempts:3});
  await until(()=>getJobQueueStats().totals.completed===2);
  assert.equal(attempts,2);assert.equal(getJobQueueStats().totals.retried,1);assert.equal(getJobQueueStats().totals.timedOut,1);
});
