# MealScout Action API - TradeScout LLM Integration

The **Action API** is a unified endpoint designed for TradeScout LLM to safely call controlled MealScout actions. All requests require authentication and return structured JSON responses.

## Base URL

```
https://mealscout.yourdomain.com/api/actions
```

## Authentication

Every request must include the `TRADESCOUT_API_TOKEN` via the Authorization header:

```bash
Authorization: Bearer <TRADESCOUT_API_TOKEN>
```

**Example:**
```bash
curl -X POST https://mealscout.yourdomain.com/api/actions \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"action": "FIND_DEALS", "params": {"search": "pizza"}}'
```

Notes:
- This is a Scout-level token (TradeScout → MealScout bridge). End-user auth is not accepted on this endpoint.
- Keep the token server-side only; never expose it in client code.

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

Canonical contract (for new or updated actions): use `results` (array) + `count` for lists; `data` for objects. Keep responses deterministic to reduce glue code.

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
      "title": "50% Off Pizza",
      "category": "food",
      "restaurantId": "rest-456",
      "description": "Half off any pizza",
      "discount": 50,
      "expiresAt": "2025-12-31T23:59:59Z"
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
      "address": "123 Main St, Downtown",
      "cuisineType": "Italian",
      "description": "Authentic Italian pizza and pasta",
      "phoneNumber": "555-1234",
      "websiteUrl": "https://marios.com",
      "isActive": true
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

Add to `.env`:
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
5. **Keep tokens secure** - Never expose `TRADESCOUT_API_TOKEN` in client code
6. **Monitor usage** - Track API calls to detect anomalies

---

## Support

For issues or feature requests, contact the MealScout development team.
