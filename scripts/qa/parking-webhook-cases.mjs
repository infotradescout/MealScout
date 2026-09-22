/** Signed HTTP acceptance for the registered booking and webhook routes.
 * Provider objects and actor authentication are explicit fixtures. All SQL,
 * migration, signature verification and financial ledger code are application code.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
export async function runParkingWebhookCases(c) {
  const { test, pool, workers, actor, event, request, rowsFor, effects, creates, webhookSecret } = c;
  const sdk = new Stripe('sk_test_local_signature_only');
  const webhook = async (worker, intent, opts = {}) => {
    const payload = JSON.stringify({ id: opts.eventId || 'evt_qa_' + randomUUID(), object: 'event', type: 'payment_intent.succeeded', created: Math.floor(Date.now()/1000), livemode: false, data: { object: intent } });
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: opts.invalid ? 'whsec_invalid_fixture' : webhookSecret });
    const r = await fetch('http://127.0.0.1:' + worker.ready.port + '/api/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload, signal: AbortSignal.timeout(20000) });
    return { status: r.status, body: await r.text() };
  };
  const paid = async (id) => {
    const row = (await pool.query('SELECT payload FROM qa_provider_intents WHERE id=$1', [id])).rows[0];
    assert.ok(row, 'Provider fixture intent must exist');
    const intent = { ...row.payload, status: 'succeeded', amount_received: row.payload.amount, amount_capturable: 0 };
    await pool.query('UPDATE qa_provider_intents SET payload=$2 WHERE id=$1', [id, JSON.stringify(intent)]);
    return intent;
  };
  const counts = async (id) => {
    const credits = (await pool.query('SELECT count(*)::int n, coalesce(sum(amount),0)::text total FROM credit_ledger WHERE source_id=$1', [id])).rows[0];
    const earnings = (await pool.query('SELECT count(*)::int n, coalesce(sum(amount_cents),0)::int total FROM host_earnings_ledger WHERE stripe_payment_intent_id=$1', [id])).rows[0];
    return { credits: credits.n, creditTotal: credits.total, earnings: earnings.n, earningsCents: earnings.total };
  };
  const book = async (extra = {}) => {
    const a = await actor(), e = await event(), key = randomUUID();
    const response = await request(workers[0], a, e, key, extra);
    assert.equal(response.status, 200, JSON.stringify(response));
    const original = await rowsFor(a), intent = await paid(response.body.paymentIntentId);
    return { a, e, key, original, intent, response };
  };
  const assertConfirmed = async (b, response) => {
    const rows = await rowsFor(b.a), ledger = await counts(b.intent.id);
    const evidence = { webhookStatus: response.status, bookings: rows.map(r => ({ id: r.id, eventId: r.event_id, status: r.status, refundStatus: r.refund_status })), ...ledger };
    console.log('PARKING_WEBHOOK_OBSERVATION ' + JSON.stringify(evidence));
    assert.equal(response.status, 200, JSON.stringify(evidence));
    assert.deepEqual(rows.map(r=>r.id).sort(), b.original.map(r=>r.id).sort(), 'No extra booking or replacement history');
    assert.ok(rows.every(r=>r.status==='confirmed' && r.stripe_payment_status==='succeeded' && r.stripe_payment_intent_id===b.intent.id && r.paid_at && !r.cancelled_at), JSON.stringify(evidence));
    assert.equal(ledger.credits, 0, 'A valid reserved payment must not be credited as overbooked');
    assert.equal(ledger.earnings, b.original.length, 'Each original hold earns once');
    assert.equal(ledger.earningsCents, b.original.reduce((n,r)=>n+r.host_price_cents,0));
    return evidence;
  };
  await test('signed webhook rejects invalid signature without booking or ledger writes', async () => {
    const b = await book(), before = await rowsFor(b.a), ledgerBefore = await counts(b.intent.id);
    const reply = await webhook(workers[1], b.intent, { invalid: true });
    assert.equal(reply.status, 400); assert.deepEqual(await rowsFor(b.a), before); assert.deepEqual(await counts(b.intent.id), ledgerBefore);
    return { status: 400, bookingHistoryUnchanged: true, ledgerUnchanged: true };
  });
  await test('normal signed payment confirms the actual route hold on its selected UTC date', async () => {
    const b = await book(); return assertConfirmed(b, await webhook(workers[1], b.intent));
  });
  await test('sparse selected dates settle the original holds rather than a reconstructed consecutive range', async () => {
    const a = await actor(), first = await event(); await event(); const last = await event(), key = randomUUID();
    const response = await request(workers[0], a, first, key, { slotType: 'weekly', selectedDates: [first.date.toISOString().slice(0,10), last.date.toISOString().slice(0,10)] });
    assert.equal(response.status, 200, JSON.stringify(response));
    const b = { a, original: await rowsFor(a), intent: await paid(response.body.paymentIntentId) };
    assert.equal(b.original.length,2); return assertConfirmed(b, await webhook(workers[2], b.intent));
  });
  await test('success webhook arriving before the create acknowledgement binds and confirms the original hold', async () => {
    const a = await actor(), e = await event(), key = randomUUID(), beforeCreates = await creates();
    c.setCreateMode('accepted-error');
    const response = await request(workers[0], a, e, key); c.setCreateMode('normal');
    assert.equal(response.status,503);
    const original = await rowsFor(a); assert.equal(original.length,1); assert.equal(original[0].stripe_payment_intent_id,null);
    const provider = (await pool.query("SELECT payload FROM qa_provider_intents WHERE payload->'metadata'->>'truckId'=$1", [a.truck.id])).rows[0].payload;
    const b = { a, original, intent: await paid(provider.id) };
    const evidence = await assertConfirmed(b, await webhook(workers[2], b.intent));
    const replay = await request(workers[3],a,e,key); assert.equal(replay.status,200); assert.equal(replay.body.outcome,'confirmed');
    assert.equal(await creates()-beforeCreates,1); return { ...evidence, createCalls:1, originalReferenceRecovered:true };
  });
  await test('concurrent and redelivered signed successes cannot duplicate booking earnings or credit', async () => {
    const b = await book(), eventId='evt_qa_'+randomUUID();
    const replies = await Promise.all(Array.from({length:8},(_,i)=>webhook(workers[i%4],b.intent,{eventId})));
    assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies));
    const evidence = await assertConfirmed(b,replies[0]), before=await rowsFor(b.a), ledgerBefore=await counts(b.intent.id);
    await webhook(workers[3],b.intent); assert.deepEqual(await rowsFor(b.a),before); assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    return {...evidence,deliveries:9,terminalReplayUnchanged:true};
  });
  await test('signed but mismatched payment amount cannot confirm or credit reserved holds', async () => {
    const b = await book(), before=await rowsFor(b.a), ledgerBefore=await counts(b.intent.id);
    const reply=await webhook(workers[2],{...b.intent,amount:100,amount_received:100});
    assert.ok(reply.status>=400,JSON.stringify(reply)); assert.deepEqual(await rowsFor(b.a),before); assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    return {status:reply.status,bookingHistoryUnchanged:true,ledgerUnchanged:true};
  });
  await test('signed payment with an unrecognized durable request identity makes no financial changes', async () => {
    const b=await book(),before=await rowsFor(b.a),ledgerBefore=await counts(b.intent.id);
    const reply=await webhook(workers[2],{...b.intent,metadata:{...b.intent.metadata,bookingRequestKey:'parking-pass:'+'f'.repeat(64)}});
    assert.ok(reply.status>=400,JSON.stringify(reply));assert.deepEqual(await rowsFor(b.a),before);assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    return {status:reply.status,bookingHistoryUnchanged:true,ledgerUnchanged:true};
  });
  await test('late signed success on a cancelled hold credits once across concurrent deliveries and preserves cancellation history', async () => {
    const b=await book(), reason='QA retained cancellation '+randomUUID(), eventId='evt_qa_'+randomUUID();
    // Seed the terminal state, not a replacement booking. Expiry itself has a separate integration suite.
    await pool.query("UPDATE event_bookings SET status='cancelled', cancelled_at=now(), cancellation_reason=$2 WHERE id=$1",[b.original[0].id,reason]);
    const cancelled=(await rowsFor(b.a))[0];
    const replies=await Promise.all(Array.from({length:8},(_,i)=>webhook(workers[i%4],b.intent,{eventId})));
    assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies));
    const rows=await rowsFor(b.a), ledger=await counts(b.intent.id);
    assert.deepEqual(rows.map(r=>r.id).sort(),b.original.map(r=>r.id).sort());
    assert.ok(rows.every(r=>r.status==='cancelled' && r.refund_status==='credit' && r.stripe_payment_status==='succeeded'));
    assert.equal(rows[0].cancellation_reason,reason);assert.deepEqual(rows[0].cancelled_at,cancelled.cancelled_at);
    assert.equal(ledger.credits,1);assert.equal(Math.round(Number(ledger.creditTotal)*100),b.intent.amount);assert.equal(ledger.earnings,0);
    const replay=await webhook(workers[3],b.intent);assert.equal(replay.status,200);
    assert.deepEqual(await rowsFor(b.a),rows);assert.deepEqual(await counts(b.intent.id),ledger);
    return {deliveries:9,credits:1,creditCents:b.intent.amount,earnings:0,originalBookingRetained:true,cancellationHistoryRetained:true,terminalReplayUnchanged:true};
  });
  await test('conflicting earnings rolls back booking confirmation and the same payment recovers after reconciliation', async () => {
    const b=await book(), hold=b.original[0], ledgerId=randomUUID();
    await pool.query("INSERT INTO host_earnings_ledger (id,host_id,booking_id,stripe_payment_intent_id,entry_type,source_type,amount_cents,description) VALUES ($1,$2,$3,$4,'booking_earned','parking_pass_booking',$5,'QA conflicting evidence')",[ledgerId,hold.host_id,hold.id,b.intent.id,hold.host_price_cents+1]);
    const before=await rowsFor(b.a), ledgerBefore=await counts(b.intent.id);
    const eventBefore=(await pool.query('SELECT * FROM events WHERE id=$1',[hold.event_id])).rows;
    const reply=await webhook(workers[2],b.intent);
    assert.equal(reply.status,503,JSON.stringify(reply));assert.deepEqual(await rowsFor(b.a),before);assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    assert.deepEqual((await pool.query('SELECT * FROM events WHERE id=$1',[hold.event_id])).rows,eventBefore);
    // Reconcile only the isolated fixture's inconsistent ledger evidence, then redeliver the same payment.
    await pool.query('UPDATE host_earnings_ledger SET amount_cents=$2 WHERE id=$1',[ledgerId,hold.host_price_cents]);
    const evidence=await assertConfirmed(b,await webhook(workers[1],b.intent));
    return {...evidence,rejectedStatus:503,bookingAndEventRollback:true,conflictingLedgerPreserved:true,samePaymentRecovered:true};
  });
  await test('signed payment cannot settle another actor through modified owner metadata', async () => {
    const b=await book(),before=await rowsFor(b.a),ledgerBefore=await counts(b.intent.id);
    const reply=await webhook(workers[2],{...b.intent,metadata:{...b.intent.metadata,userId:randomUUID()}});
    assert.equal(reply.status,503,JSON.stringify(reply));assert.deepEqual(await rowsFor(b.a),before);assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    return {status:503,bookingHistoryUnchanged:true,ledgerUnchanged:true};
  });
  await test('signed payment cannot substitute the saved payout destination', async () => {
    const b=await book(),before=await rowsFor(b.a),ledgerBefore=await counts(b.intent.id);
    const reply=await webhook(workers[2],{...b.intent,transfer_data:{destination:'acct_qa_mismatched_destination'}});
    assert.equal(reply.status,503,JSON.stringify(reply));assert.deepEqual(await rowsFor(b.a),before);assert.deepEqual(await counts(b.intent.id),ledgerBefore);
    return {status:503,bookingHistoryUnchanged:true,ledgerUnchanged:true};
  });
}
