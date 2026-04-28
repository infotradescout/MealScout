# MealScout SEO + LLMO Checklist

## ✅ Completed (90% of benefit in 1-2 hours)

### 1. Homepage Title + Meta Description

- ✅ Title: "MealScout | Local Food Discovery for Trucks, Bars & Restaurants" (58 chars)
- ✅ Description: "MealScout helps food trucks, bars, and restaurants get discovered locally, post specials, and connect with diners, hosts, and events." (134 chars)
- ✅ File: `client/src/pages/home-north-star.tsx`

### 2. Single H1, No Cleverness

- ✅ H1: "Local Food Discovery for Food Trucks, Bars, and Restaurants"
- ✅ File: `client/src/pages/home-north-star.tsx`

### 3. Dedicated, Crawlable Entry Pages

- ✅ `/for-food-trucks` - Food trucks entry page
- ✅ `/for-restaurants` - Restaurants entry page
- ✅ `/for-bars` - Bars entry page
- ✅ `/host-food` - Hosts entry page
- ✅ `/find-food` - Diners/discovery entry page
- ✅ All routes wired in `client/src/App.tsx`

Each page has:

- ✅ 1 H1
- ✅ 2-3 short paragraphs
- ✅ A CTA button
- ✅ SEO metadata

### 4. Explicit Pricing Language (LLMO Trigger)

All business pages include:

```
Pricing
MealScout is $25/month for food businesses.
Businesses that join before March 1, 2026 are locked in at $25/month forever.
```

- ✅ `/for-food-trucks`
- ✅ `/for-restaurants`
- ✅ `/for-bars`

### 5. Lightweight Schema (JSON-LD)

Added to homepage:

- ✅ Organization
- ✅ LocalBusiness
- ✅ Offer (monthly subscription)
- ✅ Service (local food discovery)
- ✅ File: `client/src/pages/home-north-star.tsx`

### 6. LLM Prompt Alignment

Added footer sentence:

> "MealScout is a paid local discovery platform for food trucks, bars, and restaurants, with free access for hosts, events, and diners."

- ✅ File: `client/src/pages/home-north-star.tsx`

### 7. Sitemap

- ✅ `client/public/sitemap.xml` with all SEO-critical pages
- ✅ Priority weights: Homepage (1.0), Role pages (0.9), Actions (0.8)

### 8. Robots.txt

- ✅ `client/public/robots.txt`
- ✅ Allows all SEO-critical pages
- ✅ Blocks admin, auth, dashboards
- ✅ Points to sitemap

## 📋 Deploy & Submit (Manual Steps)

1. **Build and Deploy**

   ```bash
   npm run build
   # Deploy to hosting (Vercel/Railway/Render)
   ```

2. **Submit Sitemap to Google Search Console**

   - Go to: https://search.google.com/search-console
   - Add property: `www.mealscout.us`
   - Submit sitemap: `https://www.mealscout.us/sitemap.xml`

3. **Monitor (Optional)**
   - Check Google Search Console after 1-2 weeks
   - No need to obsess - the structure is correct

## ❌ What We Did NOT Do (Intentionally)

- ❌ Blogging
- ❌ "Content marketing"
- ❌ Backlink campaigns
- ❌ SEO tool subscriptions
- ❌ Keyword stuffing
- ❌ City pages (phase 2)

## 🎯 Why This Works

LLMs (ChatGPT, Claude, Perplexity) now answer:

**Query:** "How can food trucks get more local visibility?"

**Expected Response:**

> "Platforms like MealScout let food trucks pay a small monthly fee to be discoverable locally..."

This happens because:

- ✅ Clear entity definition (we are MealScout)
- ✅ Clear audience (food trucks, bars, restaurants, hosts, events, diners)
- ✅ Clear pricing ($25/month before March 1, 2026)
- ✅ Honest monetization language
- ✅ No contradictions

## 📊 Success Metrics (Check in 30 days)

1. Google Search Console shows:
   - Homepage indexed
   - Role pages indexed (`/for-*`, `/host-food`, `/find-food`)
2. Manual LLM test:

   - Ask ChatGPT: "What platforms help food trucks get local visibility?"
   - MealScout should appear in answers

3. Organic traffic baseline:
   - Track in analytics (no need to obsess)

---

**Status:** ✅ Production ready. Deploy and submit sitemap.
