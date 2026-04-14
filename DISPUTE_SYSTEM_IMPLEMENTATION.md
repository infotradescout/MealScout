# Dispute System Implementation Plan

## Overview
Content moderation and community trust system. Infrastructure for flagging/moderating recommendations and business profile content. **Not a refund/payment system** — parties communicate directly, we facilitate and verify policy compliance.

## Phase 1: Data Models & Core APIs (CURRENT)
### 1.1 Database Schema

### 1.2 Backend APIs

### 1.3 Business Logic

## Phase 3: Moderation UI & Admin Tools
- [ ] Admin moderation queue (filterable by reason, status, date)
- [ ] Update Golden Fork eligibility (upheld flags against user lower score)


## Technical Notes
- **Scope**: Content moderation only, no refunds, no payment disputes
- **Parties**: Reporter, Content Author (recommendation owner), Moderator
- **Moderator Role**: Verify policy compliance, not business merit
- **Anti-Brigading**: Reporter reputation weighted into similarity scoring

## Current Status
Starting Phase 1.1 - Database schema implementation
