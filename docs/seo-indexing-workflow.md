# MealScout SEO Indexing Workflow

## Purpose
Operational checklist for shipping new SEO landing pages and getting them indexed quickly.

## Workflow
1. Publish pages and ensure each has canonical URL + schema (`SEOHead`).
2. Add internal links from:
   - `/` footer
   - `/sitemap`
   - related comparison pages
3. Verify the page appears in XML sitemap output/routes.
4. Run Lighthouse/technical checks for:
   - status `200`
   - crawlable HTML
   - unique title + meta description
5. Submit URLs in Google Search Console URL Inspection:
   - request indexing for top priority pages first
   - then submit route pattern batch through sitemap refresh
6. Monitor Search Console for:
   - discovered/crawled status
   - indexing failures
   - rich results eligibility
7. If page is not indexed after 7-14 days:
   - add another internal link from a high-traffic page
   - improve content specificity for city/cuisine/service intent
   - resubmit URL

## Priority URL Classes
1. `/compare/*`
2. `/compare/:service/local/:city/:cuisine`
3. `/delivery-app-alternatives`
4. `/online-ordering-platforms`
