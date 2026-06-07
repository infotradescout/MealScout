# 3D Eats & Tea Existing Account Enrichment

Status: `EVIDENCE_CAPTURED_APPEND_ONLY`

GitHub tracker: issue `#113`

## Operating rule

3D Eats & Tea already has a MealScout account. This artifact is **not** authorization to create a duplicate profile or overwrite existing account/profile data.

Use all supplied values as append-only enrichment:

- Fill blank fields only.
- Preserve existing owner linkage, claim status, subscription/payment status, profile/business ids, analytics, reviews, and metadata.
- Queue conflicts for owner/admin review.
- Do not replace an existing logo, menu, schedule, contact, or location value without approval.

## Evidence supplied by Thomas

1. Details/contact screenshot
2. Full menu screenshots
3. Logo image

The source images were supplied in the ChatGPT conversation and summarized in issue #113. This repo artifact captures the extracted fields and apply rules so the account can be updated safely.

## Profile fields

| Field | Candidate value | Apply handling |
|---|---|---|
| Business display name | 3-D Eats & Tea Pensacola | Fill blank only / review if existing differs |
| Brand name | 3-D Eats | Fill blank only |
| Logo text | 3-D EATS | Candidate logo evidence only |
| Email | threedtea@gmail.com | Fill blank only / review if existing differs |
| Price tier | $$ | Fill blank only |
| Recommendation | 98% recommend | Evidence only unless platform stores external recommendation score |
| Review count | 716 | Evidence only unless platform stores external review count |
| Service area | Pensacola, FL | Fill blank only |
| Facebook | 3deatsandtea | Fill blank only / review if existing differs |
| Instagram | 3deats | Fill blank only / review if existing differs |
| TikTok | 3deatspensacola | Fill blank only / review if existing differs |
| YouTube candidate 1 | eatin3d | Conflict review |
| YouTube candidate 2 | @3deats | Conflict review |
| Messenger label | 3-D Eats & Tea Pensacola | Evidence only / fill blank if supported |

## Services and service modes

From details screenshot:

- Curbside pickup
- In-store pickup
- Takeout
- Delivery
- Contactless delivery
- Outdoor seating

From menu image:

- Dine-in
- Carry out
- Catering

## Food truck address rule

Do not use static food truck addresses as live customer-facing map locations by default.

Food truck profile handling must separate:

1. Business/admin/static address
2. Operating location / scheduled stop
3. Service area / market

Menu image shows:

```text
6881 US 98 E
Pensacola, FL 32506
```

Treat this as a **candidate business/admin/static listed address only** unless explicitly confirmed as the active operating location.

Earlier details screenshot showed:

```text
Pensacola, FL, United States, 32505
```

Do not use either address/ZIP as live map location without schedule, event, or owner-confirmed active stop evidence.

Live customer-facing location must come from:

- current active schedule stop,
- upcoming scheduled stop,
- owner-confirmed operating location,
- event booking location,
- or verified live location update.

## Hours candidate

General hours shown on menu image:

```text
Monday to Saturday
11:00AM to 8:00PM
```

Structured candidate:

| Day | Hours |
|---|---|
| Monday | 11:00 AM - 8:00 PM |
| Tuesday | 11:00 AM - 8:00 PM |
| Wednesday | 11:00 AM - 8:00 PM |
| Thursday | 11:00 AM - 8:00 PM |
| Friday | 11:00 AM - 8:00 PM |
| Saturday | 11:00 AM - 8:00 PM |
| Sunday | Unknown / blank |

These appear to be general business hours. They do not replace scheduled stop/location data.

## Logo evidence

Thomas supplied a logo image with:

- large blue `3`
- red `D`
- black hyphen
- turquoise/white `EATS`
- cartoon hot dog/dog mascot with 3D glasses
- loaded hot dog/sandwich graphic

Handling:

- Use as candidate profile logo only if the existing logo field is blank.
- If an existing logo is present, queue replacement for owner/admin review.
- The circular black logo from the menu image is an alternate brand mark candidate only; do not use unless approved.

## Menu categories

- Hot Dogs
- 3-D's Taste of Chicago
- Sides
- Beverages
- Kid's Meals
- Desserts
- Starters
- Signature Fries
- 3-D Melts
- Cheesesteaks
- Crafted Burgers
- Sandwiches

## Menu read

### Hot Dogs

Section note: Featuring Vienna Beef Hot Dogs. Comes with choice of one side or regular drink.

| Item | Description | Variant | Price |
|---|---|---:|---:|
| Classic | Sweet relish & onion | 1 Dog | 7.00 |
| Classic | Sweet relish & onion | 2 Dogs | 10.00 |
| Pulled Pork | Pulled pork with BBQ sauce | 1 Dog | 8.00 |
| Pulled Pork | Pulled pork with BBQ sauce | 2 Dogs | 11.00 |
| Chili Cheese |  | 1 Dog | 8.00 |
| Chili Cheese |  | 2 Dogs | 11.00 |
| Bacon Cheddar Jalapeno |  | 1 Dog | 8.00 |
| Bacon Cheddar Jalapeno |  | 2 Dogs | 11.00 |
| Slaw Dog |  | 1 Dog | 8.00 |
| Slaw Dog |  | 2 Dogs | 11.00 |

### 3-D's Taste of Chicago

Section note: Comes with choice of one side or regular drink.

| Item | Description | Price |
|---|---|---:|
| Chicago Style Dog | Mustard, onion, Chicago relish, pickle spear, tomato, celery salt, sport pepper | 8.00 |
| Jumbo Beef Polish |  | 10.00 |
| Maxwell Street Polish | Grilled onions, mustard, & sport peppers | 10.00 |
| Italian Beef | Shaved oven-roasted beef, dipped in Italian gravy, dry or dipped. Baked with mozzarella add $2. | 14.00 |
| Italian Sausage | Sweet Italian sausage with onions & sweet peppers | 10.00 |
| Beef & Sausage Bomber | Italian sausage nestled inside an Italian beef | 16.00 |
| Gyro | Beef & lamb, onions, tomatoes, tzatziki | 13.00 |
| Chicago Pizza Puff | No side included | 4.00 |

### Sides

| Item | Notes | Price |
|---|---|---:|
| French Fries |  | 4.00 |
| Side Salad |  | 4.00 |
| Baked Beans |  | 4.00 |
| Coleslaw |  | 4.00 |
| Potato Salad |  | 4.00 |
| Onion Rings |  | 4.00 |
| Buttered Baked Potato | Load it for $2 more | 4.00 |

### Beverages

Section note: Refillable Mason Jar $10. Refills available for $1. Starred drinks show no refills.

| Item | Size | Price | Notes |
|---|---:|---:|---|
| 3D Tea | 16oz | 3.00 | No refills |
| 3D Tea | 32oz | 5.00 | No refills |
| Lemonade | 16oz | 3.00 | No refills |
| Lemonade | 32oz | 5.00 | No refills |
| Arnold Palmer | 16oz | 3.00 | No refills |
| Arnold Palmer | 32oz | 5.00 | No refills |
| 16oz Drink | 16oz | 2.50 | Coca-Cola / Diet Coke / Coca-Cola Zero / Sprite / Dr Pepper / Powerade shown |
| Refillable Mason Jar |  | 10.00 |  |
| Mason Jar Refill |  | 1.00 |  |

### Kid's Meals

Section note: Comes with kid fry, drink, & treat.

| Item | Price |
|---|---:|
| Small Burger | 8.00 |
| Hot Dog | 8.00 |
| Grilled Cheese | 8.00 |
| Kid's Chicken | 8.00 |

### Desserts

| Item | Price |
|---|---:|
| Deep Fried Oreos (4) | 5.00 |
| Banana Pudding | 5.00 |

### Starters

| Item | Description / Options | Price |
|---|---|---:|
| Mozzarella Sticks | With marinara | 8.00 |
| Jalapeno Cheddar Bites |  | 8.00 |
| Fried Pickles |  | 8.00 |
| Onion Ring Basket |  | 8.00 |
| Loaded Fries | Choice of style: Cheese, Southwest, Bacon Cheese, Bacon Ranch Cheese, Samurai, Chili Cheese | 8.00 |

### Signature Fries

Section note: All fries come with cheese sauce, shredded cheese, & choice of toppings.

| Item | Options / Notes | Price |
|---|---|---:|
| Chicken Fries | Buffalo Ranch, BBQ, Bacon Ranch, Southwest, Samurai | 14.00 |
| Cheesesteak Fries | Classic, Southwest, BBQ | 14.00 |
| Pulled Pork Fries |  | 14.00 |

### 3-D Melts

Section note: On crispy sourdough. Comes with choice of one side or regular drink.

| Item | Description / Options | Price |
|---|---|---:|
| Grilled Cheese | American, Swiss, shredded cheddar jack | 10.00 |
| Pulled Pork Melt | With BBQ sauce | 15.00 |
| Cheesesteak Melt | Steak, grilled onions, American & Cooper Sharp cheese | 15.00 |
| B.F.C. Melt | B.F.C. on sourdough. Options: Buffalo Ranch, BBQ, Classic, Southwest | 15.00 |

### Cheesesteaks

Section note: Premium steak, Amoroso roll, Cooper Sharp cheese. Comes with choice of one side or regular drink.

| Item | Description | Price |
|---|---|---:|
| Classic | With onions | 14.00 |
| Club | With onions, lettuce, tomato | 15.00 |
| Southwest | With onions, jalapenos, & southwest sauce | 15.00 |
| Samurai | With onions, Samurai sauce | 15.00 |

### Crafted Burgers

Section note: Comes with choice of one side or regular drink.

| Item | Description | Single | Double |
|---|---|---:|---:|
| Classic | Lettuce, tomato, onion, pickles | 9.00 | 12.00 |
| Bacon It Rain | Classic loaded with bacon | 11.00 | 14.00 |
| BBQ Bacon | Bacon, American cheese, 2 onion rings, BBQ sauce | 11.00 | 14.00 |
| Grilled Cheeseburger | Buttered grilled bun, Swiss & American cheese | 11.00 | 14.00 |
| Fire in the Hole | Pepper Jack cheese, grilled jalapeno, southwest sauce | 11.00 | 14.00 |
| Samurai Bacon | Bacon, American cheese, sweet chili sauce with a fight | 11.00 | 14.00 |
| Philly Burger | Cheesesteak topped burger | 12.00 | 15.00 |
| Patty Melt | On grilled sourdough, Swiss & American cheese, grilled onions | 14.00 |  |

### Sandwiches

Section note: Comes with choice of one side or regular drink.

| Item | Description | Price |
|---|---|---:|
| B.L.T. | On crispy sourdough | 12.00 |
| Pulled Pork | Smokey pork with BBQ sauce | 13.00 |
| B.F.C. | Jumbo fried chicken sandwich with lettuce & tomato | 12.00 |

## Conflict flags

| Field | Evidence A | Evidence B | Required action |
|---|---|---|---|
| Address / ZIP | Pensacola, FL, United States, 32505 | 6881 US 98 E, Pensacola, FL 32506 | Do not overwrite; review |
| YouTube | eatin3d | @3deats | Do not overwrite; review |
| Logo | Colorful mascot logo supplied | Circular black logo appears on menu | Do not overwrite; review if existing logo present |

## Missing fields

- Phone number
- Website
- Confirmed live operating location
- Current scheduled stops
- Confirmation that supplied menu is current
- Confirmation that supplied logo is owner-approved
- Decision on whether circular black logo should be stored as alternate brand mark
- Existing MealScout account/profile field comparison

## Apply task

Inspect existing MealScout account/profile for 3D Eats & Tea. Apply this evidence as append-only enrichment only.

Return:

- Existing account/profile found
- Existing fields already populated
- Blank fields safely filled
- Conflicts queued for review
- Missing fields remaining
- Files changed
- Validation commands run
- Any blockers
