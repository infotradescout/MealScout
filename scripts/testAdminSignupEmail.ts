import assert from "node:assert/strict";

import { renderAdminSignupEmail } from "../server/emailService";

const makeUser = (userType: string) =>
  ({
    id: `test-${userType}`,
    email: `${userType}@example.test`,
    firstName: "Test",
    lastName: "User",
    userType,
    emailVerified: false,
  }) as any;

const expectations: Array<[string, string]> = [
  ["customer", "Customer"],
  ["restaurant_owner", "Restaurant Owner"],
  ["food_truck", "Food Truck Owner"],
  ["supplier", "Supplier"],
  ["host", "Host / Venue"],
  ["event_coordinator", "Event Organizer"],
  ["staff", "Staff"],
  ["admin", "Admin"],
  ["super_admin", "Super Admin"],
];

for (const [userType, expectedLabel] of expectations) {
  const rendered = renderAdminSignupEmail(makeUser(userType), {
    signupMethod: "email",
  });

  assert.match(rendered.html, new RegExp(`User Type:</strong> ${expectedLabel}`));
  assert.match(rendered.text, new RegExp(`User Type: ${expectedLabel}`));

  if (userType !== "admin") {
    assert.doesNotMatch(
      rendered.text,
      /User Type: Admin\b/,
      `${userType} should not be labeled Admin`,
    );
  }
}

const foodTruckEmail = renderAdminSignupEmail(makeUser("food_truck"));
assert.match(foodTruckEmail.text, /food truck owner account may require/);

const enrichedFoodTruckEmail = renderAdminSignupEmail(makeUser("food_truck"), {
  signupMethod: "email",
  accountType: "business",
  businessType: "food_truck",
  sourcePage: "/truck-onboarding?source=facebook",
  landingSource: "facebook",
  utmCampaign: "truck-launch",
  utmMedium: "paid_social",
  device: "facebook_iab",
  signupResult: "created_requires_email_verification",
});
assert.match(enrichedFoodTruckEmail.text, /Acquisition Details:/);
assert.match(enrichedFoodTruckEmail.text, /Account Type: business/);
assert.match(enrichedFoodTruckEmail.text, /Business Type: food_truck/);
assert.match(enrichedFoodTruckEmail.text, /Source Page: \/truck-onboarding/);
assert.match(enrichedFoodTruckEmail.text, /Landing Source: facebook/);
assert.match(enrichedFoodTruckEmail.text, /Campaign: truck-launch/);
assert.match(enrichedFoodTruckEmail.text, /Medium: paid_social/);
assert.match(enrichedFoodTruckEmail.text, /Device: facebook_iab/);
assert.match(
  enrichedFoodTruckEmail.text,
  /Signup Result: created_requires_email_verification/,
);

const customerEmail = renderAdminSignupEmail(makeUser("customer"));
assert.doesNotMatch(customerEmail.text, /ACTION REQUIRED:/);
assert.match(customerEmail.text, /A new account was created in MealScout:/);

console.log("admin signup email role labels test passed");
