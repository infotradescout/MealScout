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

const customerEmail = renderAdminSignupEmail(makeUser("customer"));
assert.doesNotMatch(customerEmail.text, /ACTION REQUIRED:/);
assert.match(customerEmail.text, /A new account was created in MealScout:/);

console.log("admin signup email role labels test passed");
