# MealScout Action API

The **Action API** is currently a read-only public-discovery endpoint for trusted server-side integrations. Static integration tokens do not establish an end-user identity and cannot perform user-scoped actions. All requests require authentication and return structured JSON responses.

> **Release hold:** Only `FIND_DEALS`, `FIND_RESTAURANTS`, `GET_RESTAURANT_DETAILS`, `GET_FOOD_TRUCKS`, and `GET_PARKING_PASS_SPOTS` are executable through integration tokens. Implemented user-scoped actions return HTTP `403` with `ACTION_REQUIRES_TRUSTED_PRINCIPAL` until MealScout derives the actor from a verified user credential or server-recorded delegation. Reserved unimplemented actions remain `501`; unknown names remain `400`.

## Base URL

```
https://mealscout.yourdomain.com/api/actions
```

## Authentication

Every request must include one of these environment tokens via the Authorization header:

```bash
Authorization: Bearer <MEALSCOUT_ACTION_TOKEN>
```

**Example:**
```bash
curl -X POST https://mealscout.yourdomain.com/api/actions \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"action": "FIND_DEALS", "params": {"search": "pizza"}}'
```

Notes:
- This is a MealScout action token used by trusted server integrations (including paid/free LLM adapters). End-user auth is not accepted on this endpoint.
- Keep the token server-side only; never expose it in client code.

### Availability

The Action API is model-agnostic: it is a server API protected by `MEALSCOUT_ACTION_TOKEN(S)` (or legacy `TRADESCOUT_API_TOKEN(S)`), not a ChatGPT-only feature. Those integration tokens currently authorize only the public discovery read allowlist above. They do not authorize an integration to act as a submitted `userId`.

### Use from Any LLM (not ChatGPT-only)

The same endpoint works from free or paid models as long as the model can call an external HTTPS endpoint (most tool-enabled providers can).

What to send:
- `POST /api/actions`
- `Authorization: Bearer <MEALSCOUT_ACTION_TOKEN>`
- JSON body: `{ "action": "ACTION_NAME", "params": { ... } }`

User-scoped mutation payloads such as the following are retained as future contract documentation but are blocked under the current integration-token identity model:

```json
{
  "action": "UPDATE_RESTAURANT_PROFILE",
  "params": {
    "userId": "user_abc123",
    "restaurantId": "rest_456",
    "updates": {
      "description": "Updated profile description from LLM flow."
    }
  }
}
```

Examples:

- OpenAI-compatible tool call:
  - `name`: `mealscout_action`
  - `arguments`: above JSON payload
- Anthropic tool pattern:
  - invoke external tool/HTTPS connector with same headers + body
- Google/Gemini custom request:
  - execute the same `curl`-style POST with the same `Authorization` token
- Any server-side relay:
  - forward this request from your relay, never from browser/client secrets

## Response Format

All responses follow a consistent JSON structure:

### Success Response
```json
{
  "success": true,
  "data": { /* action-specific data or a results array */ },
  "results": [ /* canonical array shape for list responses */ ],
  "count": 5,
  "message": "Optional success message"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "supportedActions": [/* list of available actions */]
}
```

Canonical contract for new or versioned actions: use `results` (array) + `count` for lists and `data` for objects. The five existing public-discovery reads retain their deployed `data` + `count` list envelope for compatibility.

### Public-read projection boundary

The five executable reads use strict allowlisted response objects. Database rows are never Action API responses, and fields not listed here are rejected by the runtime schema.

- Deal: `id`, `restaurantId`, `title`, `description`, `dealType`, `discountValue`, `imageUrl`, `startDate`, `endDate`, `startTime`, `endTime`, `availableDuringBusinessHours`, `isOngoing`.
- Restaurant summary/detail: `id`, `name`, `businessType`, `cuisineType`, `description`, `city`, `state`, `logoUrl`, `coverImageUrl`, `isFoodTruck`, `isVerified`, `operatingHoursSummary`.
- Live food truck: the restaurant keys above plus `mobileOnline`, `currentLatitude`, `currentLongitude`, `lastBroadcastAt`, `liveUntilAt`, `distance`, `distanceMiles`, `lat`, `lng`, `liveBroadcasting`, `locationSource`.
- Parking Pass spot: `hostId`, `type`, `name`, `address`, `city`, `state`, `latitude`, `longitude`, `pricingCents`, `maxTrucks`, `startTime`, `endTime`, `nextDate`, `paymentsEnabled`, `distanceKm`. `pricingCents` contains only `breakfast`, `lunch`, `dinner`, `daily`, `weekly`, and `monthly`.

Security compatibility note: restaurant `address`, `phone`/`phoneNumber`, and `websiteUrl` were previously shown in the detail example but are intentionally not part of the Action API projection. That is a breaking removal made to prevent this integration surface from bypassing owner-controlled public-profile visibility. Owner-approved address and contact fields remain available through MealScout's canonical public-profile surface.

## Supported Actions

### 1. FIND_DEALS

Search for active deals by location, category, or text.

**Intent:** `discover_now`

**Parameters:**
```json
{
  "action": "FIND_DEALS",
  "params": {
    "search": "string (optional) - search in deal titles",
    "category": "string (optional) - filter by category",
    "location": "string (optional) - filter by location",
    "limit": "number (optional, default: 20, max: 100)",
    "offset": "number (optional, default: 0)"
  }
}
```

**Example Request:**
```bash
curl -X POST https://mealscout.yourdomain.com/api/actions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "FIND_DEALS",
    "params": {
      "search": "pizza",
      "location": "downtown",
      "limit": 10
    }
  }'
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "deal-123",
      "restaurantId": "rest-456",
      "title": "50% Off Pizza",
      "description": "Half off any pizza",
      "dealType": "percentage",
      "discountValue": 50,
      "imageUrl": "https://images.example/deal-123.jpg",
      "startDate": "2026-08-01T00:00:00.000Z",
      "endDate": null,
      "startTime": "11:00",
      "endTime": "14:00",
      "availableDuringBusinessHours": false,
      "isOngoing": true
    }
  ],
  "count": 1
}
```

---

### 2. FIND_RESTAURANTS

Search for restaurants by name, location, or cuisine type.

**Intent:** `discover_now`

**Parameters:**
```json
{
  "action": "FIND_RESTAURANTS",
  "params": {
    "search": "string (optional) - restaurant name",
    "location": "string (optional) - city/address",
    "cuisine": "string (optional) - cuisine type",
    "limit": "number (optional, default: 20, max: 100)",
    "offset": "number (optional, default: 0)"
  }
}
```

**Example Request:**
```bash
curl -X POST https://mealscout.yourdomain.com/api/actions \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "FIND_RESTAURANTS",
    "params": {
      "search": "Mario''s",
      "cuisine": "Italian"
    }
  }'
```

---

### 3. GET_RESTAURANT_DETAILS

Get detailed information about a specific restaurant and its active deals.

**Intent:** `discover_now`

**Parameters:**
```json
{
  "action": "GET_RESTAURANT_DETAILS",
  "params": {
    "restaurantId": "string (required)"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "restaurant": {
      "id": "rest-123",
      "name": "Mario's Pizzeria",
      "businessType": "restaurant",
      "cuisineType": "Italian",
      "description": "Authentic Italian pizza and pasta",
      "city": "Pensacola",
      "state": "FL",
      "logoUrl": "https://images.example/marios-logo.jpg",
      "coverImageUrl": "https://images.example/marios-cover.jpg",
      "isFoodTruck": false,
      "isVerified": true,
      "operatingHoursSummary": "Mon 11:00 AM-10:00 PM"
    },
    "activeDeals": [/* array of deal objects */],
    "dealCount": 3
  }
}
```

---

### 4. CREATE_RESTAURANT

Create a new restaurant (restaurant owner action).

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "CREATE_RESTAURANT",
  "params": {
    "userId": "string (required) - owner's user ID",
    "name": "string (required)",
    "address": "string (required)",
    "cuisineType": "string (optional)",
    "description": "string (optional)",
    "phoneNumber": "string (optional)",
    "websiteUrl": "string (optional)"
  }
}
```

---

### 5. UPDATE_RESTAURANT

Update restaurant information (restaurant owner action).

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "UPDATE_RESTAURANT",
  "params": {
    "restaurantId": "string (required)",
    "userId": "string (required) - must be the owner",
    "updates": {
      "name": "string (optional)",
      "description": "string (optional)",
      "phoneNumber": "string (optional)",
      "websiteUrl": "string (optional)",
      "cuisineType": "string (optional)"
    }
  }
}
```

---

### 6. GET_FOOD_TRUCKS

Get nearby food truck locations within a radius.

**Intent:** `discover_now`

**Parameters:**
```json
{
  "action": "GET_FOOD_TRUCKS",
  "params": {
    "latitude": "number (required)",
    "longitude": "number (required)",
    "radiusKm": "number (optional, default: 5)"
  }
}
```

**Example:**
```json
{
  "action": "GET_FOOD_TRUCKS",
  "params": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "radiusKm": 2
  }
}
```

Notes:
- `radiusKm` max = 50; values above are capped.
- Invalid coordinates are rejected.

---

### 7. GET_PARKING_PASS_SPOTS

Get nearby **Parking Pass** spots (host locations offering paid truck parking passes) within a radius.

**Intent:** `discover_now`

**Parameters:**
```json
{
  "action": "GET_PARKING_PASS_SPOTS",
  "params": {
    "latitude": "number (required)",
    "longitude": "number (required)",
    "radiusKm": "number (optional, default: 12, max: 80)",
    "horizonDays": "number (optional, default: 30, max: 90)"
  }
}
```

**Example:**
```json
{
  "action": "GET_PARKING_PASS_SPOTS",
  "params": {
    "latitude": 30.5315,
    "longitude": -86.4989,
    "radiusKm": 10
  }
}
```

Notes:
- Only returns **public-ready** listings (pricing complete and address eligible for map display).
- Results are deduped by host location and sorted by nearest distance.

---

### 8. REDEEM_CREDITS

Redeem user credits (user action).

**Intent:** `save`

**Parameters:**
```json
{
  "action": "REDEEM_CREDITS",
  "params": {
    "userId": "string (required)",
    "amount": "number (required, must be > 0)",
    "dealId": "string (optional) - which deal was redeemed",
    "reason": "string (optional) - reason for redemption"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "newBalance": 450,
    "amountRedeemed": 50
  }
}
```

---

### 9. GET_CREDITS_BALANCE

Check user's credit balance.

**Intent:** `save`

**Parameters:**
```json
{
  "action": "GET_CREDITS_BALANCE",
  "params": {
    "userId": "string (required)"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "userId": "user-123",
    "balance": 500
  }
}
```

---

### 10. SUBMIT_BUILDER_APPLICATION

Submit a community builder application (user action).

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "SUBMIT_BUILDER_APPLICATION",
  "params": {
    "userId": "string (required)",
    "countyName": "string (required)",
    "motivation": "string (optional)",
    "experience": "string (optional)"
  }
}
```

### 11. UPDATE_RESTAURANT_PROFILE

Update editable owner profile metadata.

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "UPDATE_RESTAURANT_PROFILE",
  "params": {
    "userId": "string (required)",
    "restaurantId": "string (required)",
    "updates": {
      "name": "string",
      "description": "string",
      "cuisineType": "string",
      "address": "string",
      "city": "string",
      "state": "string",
      "phone": "string",
      "websiteUrl": "string",
      "facebookPageUrl": "string",
      "instagramUrl": "string",
      "xUrl": "string",
      "menuUrl": "string",
      "logoUrl": "string",
      "coverImageUrl": "string",
      "onlineOrderingUrl": "string",
      "deliveryUrl": "string",
      "doordashUrl": "string",
      "uberEatsUrl": "string",
      "toastUrl": "string",
      "squareUrl": "string",
      "chowNowUrl": "string",
      "grubhubUrl": "string",
      "cateringInquiryUrl": "string",
      "truckBookingInquiryUrl": "string"
    }
  }
}
```

### 12. UPDATE_RESTAURANT_LOCATION

Update restaurant coordinates and optional city/state metadata.

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "UPDATE_RESTAURANT_LOCATION",
  "params": {
    "userId": "string (required)",
    "restaurantId": "string (required)",
    "latitude": "number (required)",
    "longitude": "number (required)",
    "city": "string (optional)",
    "state": "string (optional)",
    "mobileOnline": "boolean (optional)"
  }
}
```

### 13. UPDATE_RESTAURANT_OPERATING_HOURS

Replace operating hours configuration.

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "UPDATE_RESTAURANT_OPERATING_HOURS",
  "params": {
    "userId": "string (required)",
    "restaurantId": "string (required)",
    "operatingHours": "object (required)"
  }
}
```

### 14. LIST_MENUS

List all menus for a restaurant.

**Intent:** `owner_manage`

**Parameters:**
```json
{
  "action": "LIST_MENUS",
  "params": {
    "userId": "string (required)",
    "restaurantId": "string (required)"
  }
}
```

### 15. CREATE_MENU
### 16. UPDATE_MENU
### 17. DELETE_MENU

Manage restaurant menu entities (create/update/delete).  
`UPDATE_MENU` requires `menuId`; `DELETE_MENU` requires `menuId`.

```json
{
  "action": "CREATE_MENU",
  "params": {
    "userId": "string (required)",
    "restaurantId": "string (required)",
    "name": "string",
    "serviceType": "string",
    "availableFrom": "HH:MM",
    "availableTo": "HH:MM",
    "availableDays": ["mon","tue","wed","thu","fri","sat","sun"],
    "isActive": "boolean",
    "acceptsCash": "boolean",
    "hidePlatformFee": "boolean",
    "importSource": "string"
  }
}
```

```json
{
  "action": "UPDATE_MENU",
  "params": {
    "userId": "string (required)",
    "menuId": "string (required)",
    "updates": { "...": "..." }
  }
}
```

```json
{
  "action": "DELETE_MENU",
  "params": {
    "userId": "string (required)",
    "menuId": "string (required)"
  }
}
```

### 18. CREATE_MENU_CATEGORY
### 19. UPDATE_MENU_CATEGORY
### 20. DELETE_MENU_CATEGORY

Menu category operations use `menuId` for create and `categoryId` for update/delete.

### 21. CREATE_MENU_ITEM
### 22. UPDATE_MENU_ITEM
### 23. DELETE_MENU_ITEM

Menu item operations use `menuId` for create and `itemId` for update/delete.

### 24. GET_MANUAL_SCHEDULES
### 25. UPSERT_MANUAL_SCHEDULE
### 26. DELETE_MANUAL_SCHEDULE

Manual parking schedule operations are scoped to a truck `truckId`.  
`UPSERT_MANUAL_SCHEDULE` can create (no `scheduleId`) or update (`scheduleId`) one entry.

### 27. BOOK_PARKING_SPOT

Create a pending booking with a Stripe payment intent for a Parking Pass event.

**Intent:** `save`

**Parameters:**
```json
{
  "action": "BOOK_PARKING_SPOT",
  "params": {
    "userId": "string (required)",
    "truckId": "string (required)",
    "eventId": "string (required if passId/spotId not provided)",
    "passId": "string (optional)",
    "spotId": "string (optional)"
  }
}
```

On success, returns a `clientSecret` plus `paymentIntentId`. If payment intent creation is temporarily unavailable, a `paymentPending` response is returned.

--- 

## Unavailable Actions

The following county actions are reserved contract names, not supported
runtime actions. MealScout returns HTTP `501` with
`code: "ACTION_NOT_IMPLEMENTED"` for each one. Clients must not present them
as available capabilities.

### GET_COUNTY_TRANSPARENCY — unavailable

Get transparency data for a specific county.

**Intent:** `discover_now`
**Scope:** `read_only` (writes: false; writable county data is governed by TradeScout only)

**Parameters:**
```json
{
  "action": "GET_COUNTY_TRANSPARENCY",
  "params": {
    "countyName": "string (required)"
  }
}
```

---

### GET_COUNTY_LEDGER — unavailable

Get redemption ledger for a county.

**Intent:** `discover_now`
**Scope:** `read_only` (writes: false; writable county data is governed by TradeScout only)

**Parameters:**
```json
{
  "action": "GET_COUNTY_LEDGER",
  "params": {
    "countyName": "string (required)",
    "limit": "number (optional, default: 100, max: 500)"
  }
}
```

---

### GET_COUNTY_VAULT — unavailable

Get county vault status and financial information.

**Intent:** `discover_now`
**Scope:** `read_only` (writes: false; writable county data is governed by TradeScout only)

**Parameters:**
```json
{
  "action": "GET_COUNTY_VAULT",
  "params": {
    "countyName": "string (required)"
  }
}
```

---

## Rate Limiting

The Action API has generous rate limits to support LLM operations:

- **100 requests per minute** per IP address
- Exceeded limits return `429 Too Many Requests`
- Check `Retry-After` header for retry timing

---

## Error Handling

Common error responses:

### Missing Authentication
```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid Authorization header"
}
```

### Invalid Action
```json
{
  "error": "Unknown action: INVALID_ACTION",
  "supportedActions": ["FIND_DEALS", "FIND_RESTAURANTS", ...]
}
```

### Invalid Parameters
```json
{
  "success": false,
  "error": "Missing required fields: userId, amount (must be > 0)"
}
```

### Rate Limited
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded: 100 requests per minute",
  "retryAfter": 45
}
```

---

## Setup Instructions

### 1. Set the API Token

Generate a secure token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env` (or your deployment environment):
```
MEALSCOUT_ACTION_TOKEN=your_generated_token
```

Legacy compatibility:
```
TRADESCOUT_API_TOKEN=your_generated_token
```

### 2. Configure CORS (if needed)

If TradeScout is on a different domain, add it to `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://tradescout.yourdomain.com,https://mealscout.yourdomain.com
```

### 3. Test the Connection

```bash
curl -X POST https://mealscout.yourdomain.com/api/actions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"action": "FIND_DEALS", "params": {"limit": 1}}'
```

---

## Best Practices

1. **Always validate responses** - Check the `success` field before using data
2. **Handle errors gracefully** - Implement exponential backoff for retries
3. **Cache results** - Don't repeatedly query the same data
4. **Paginate** - Use `limit` and `offset` for large datasets
5. **Keep tokens secure** - Never expose `MEALSCOUT_ACTION_TOKEN` in client code
6. **Monitor usage** - Track API calls to detect anomalies

---

## Support

For issues or feature requests, contact the MealScout development team.
