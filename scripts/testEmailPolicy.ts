import assert from "node:assert/strict";
import {
  canEmailForTopic,
  canSmsForTopic,
  isNotificationChannelEnabled,
  isNotificationTopicEnabled,
  parseAdminBroadcastMaxRecipients,
} from "../server/utils/notificationPreferences";
import { isHourWithinWindow } from "../server/utils/marketingEmailWindow";

const prefs = {
  notifications: {
    channels: {
      email: false,
      sms: true,
    },
    topics: {
      businessMessages: true,
      nearbyEvents: false,
    },
  },
};

assert.equal(isNotificationChannelEnabled(undefined, "email"), true);
assert.equal(isNotificationTopicEnabled(undefined, "nearbyEvents"), true);
assert.equal(isNotificationChannelEnabled(prefs, "email"), false);
assert.equal(isNotificationChannelEnabled(prefs, "sms", false), true);
assert.equal(isNotificationTopicEnabled(prefs, "nearbyEvents"), false);
assert.equal(canEmailForTopic(prefs, "businessMessages"), false);
assert.equal(canSmsForTopic(prefs, "businessMessages"), true);
assert.equal(canSmsForTopic(prefs, "nearbyEvents"), false);

assert.equal(parseAdminBroadcastMaxRecipients(undefined), 250);
assert.equal(parseAdminBroadcastMaxRecipients("10"), 10);
assert.equal(parseAdminBroadcastMaxRecipients("10.9"), 10);
assert.equal(parseAdminBroadcastMaxRecipients("0"), 1);
assert.equal(parseAdminBroadcastMaxRecipients("-99"), 1);
assert.equal(parseAdminBroadcastMaxRecipients("5000"), 1000);
assert.equal(parseAdminBroadcastMaxRecipients("not-a-number"), 250);

assert.equal(isHourWithinWindow(8, 8, 20), true);
assert.equal(isHourWithinWindow(19, 8, 20), true);
assert.equal(isHourWithinWindow(20, 8, 20), false);
assert.equal(isHourWithinWindow(23, 22, 6), true);
assert.equal(isHourWithinWindow(3, 22, 6), true);
assert.equal(isHourWithinWindow(12, 22, 6), false);
assert.equal(isHourWithinWindow(12, 8, 8), true);

console.log("email policy checks passed");
