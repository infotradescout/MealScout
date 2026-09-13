import assert from "node:assert/strict";
import { TransactionalEmailsApi } from "@getbrevo/brevo";

process.env.BREVO_API_KEY = "fixture-brevo-key";
process.env.EMAIL_NOTIFICATIONS_MODE = "all";
process.env.EMAIL_FROM = "fixture@mealscout.invalid";

const originalSend = TransactionalEmailsApi.prototype.sendTransacEmail;

try {
  const { emailService } = await import("../server/emailService");
  let providerCalls = 0;

  TransactionalEmailsApi.prototype.sendTransacEmail = async function () {
    providerCalls += 1;
    throw Object.assign(new Error("provider rejected invalid content"), {
      status: 422,
      response: { status: 422, body: { code: "invalid_parameter" } },
    });
  } as any;
  const rejected = await emailService.sendBasicEmailWithReceipt(
    "recipient@example.invalid",
    "Definitive rejection",
    "<p>fixture</p>",
    "fixture",
    "general",
    "fixture-email-rejection-v1",
  );
  assert.equal(rejected.sent, false);
  assert.equal(rejected.providerStatus, "invalid_parameter");
  assert.equal(
    rejected.retrySafe,
    true,
    "HTTP 422 proves the provider did not accept delivery work",
  );

  TransactionalEmailsApi.prototype.sendTransacEmail = async function () {
    providerCalls += 1;
    throw Object.assign(new Error("connection reset after request write"), {
      code: "ECONNRESET",
    });
  } as any;
  const connectionUnknown = await emailService.sendBasicEmailWithReceipt(
    "recipient@example.invalid",
    "Connection ambiguity",
    "<p>fixture</p>",
    "fixture",
    "general",
    "fixture-email-connection-v1",
  );
  assert.equal(connectionUnknown.sent, false);
  assert.equal(connectionUnknown.providerStatus, "ECONNRESET");
  assert.equal(
    connectionUnknown.retrySafe,
    false,
    "a connection failure after request write is accepted-unknown",
  );

  TransactionalEmailsApi.prototype.sendTransacEmail = async function () {
    providerCalls += 1;
    throw Object.assign(new Error("provider response timed out"), {
      code: "ETIMEDOUT",
    });
  } as any;
  const acceptedTimeout = await emailService.sendBasicEmailWithReceipt(
    "recipient@example.invalid",
    "Accepted timeout ambiguity",
    "<p>fixture</p>",
    "fixture",
    "general",
    "fixture-email-timeout-v1",
  );
  assert.equal(acceptedTimeout.sent, false);
  assert.equal(acceptedTimeout.providerStatus, "ETIMEDOUT");
  assert.equal(acceptedTimeout.retrySafe, false);

  let acceptedPayload: any = null;
  TransactionalEmailsApi.prototype.sendTransacEmail = async function (
    payload: any,
  ) {
    providerCalls += 1;
    acceptedPayload = payload;
    return { body: { messageId: "fixture-provider-message-1" } } as any;
  } as any;
  const accepted = await emailService.sendBasicEmailWithReceipt(
    "recipient@example.invalid",
    "Accepted",
    "<p>fixture</p>",
    "fixture",
    "general",
    "fixture-email-accepted-v1",
  );
  assert.deepEqual(accepted, {
    sent: true,
    providerStatus: "provider_accepted",
    providerMessageId: "fixture-provider-message-1",
    retrySafe: false,
  });
  assert.equal(
    acceptedPayload?.headers?.["X-Mealscout-Idempotency-Key"],
    "fixture-email-accepted-v1",
  );
  assert.equal(providerCalls, 4);

  console.log(
    "email-adapter-receipt: definitive HTTP rejection retry-safe; connection/timeout ambiguous PASS",
  );
} finally {
  TransactionalEmailsApi.prototype.sendTransacEmail = originalSend;
}
