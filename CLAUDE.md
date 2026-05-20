# AI Tracking Audit Tool - Project Documentation

## Project Overview

Professional AI-powered Tracking Audit & Conversion Intelligence Tool for Meta and Google platforms. Monitors tracking quality, validates conversion signals, and provides real-time recommendations to improve tracking implementation.

**Current Status:** MVP Foundation Complete - Ready for Feature Development

---

## Tech Stack

- **Frontend:** Next.js 14 with TypeScript
- **Backend:** Cloudflare Workers with tRPC (foundation ready)
- **Database:** Cloudflare D1 (SQLite) - configured in wrangler.toml
- **Storage:** Cloudflare R2 - configured in wrangler.toml
- **Real-time:** Cloudflare Durable Objects WebSocket - placeholde ready
- **AI:** RunPod instances for custom Python workflows
- **Styling:** Tailwind CSS

---

## Project Structure

```
/auditor
├── /src
│   ├── /pages
│   │   ├── index.tsx                 # Landing page with onboarding guides
│   │   ├── _app.tsx                  # Next.js app shell
│   │   ├── /app
│   │   │   └── dashboard.tsx         # Main dashboard with tab navigation
│   │   └── /api
│   │       └── trpc.ts               # tRPC API placeholder
│   ├── /components
│   │   ├── /dashboard                # Dashboard components
│   │   │   ├── HealthScoreCard.tsx   # Health score display card
│   │   │   ├── OverviewTab.tsx       # Overview tab (main KPIs)
│   │   │   ├── PixelHealthTab.tsx    # Pixel health monitoring
│   │   │   ├── EventQualityTab.tsx   # EMQ analysis tab
│   │   │   ├── FunnelAuditTab.tsx    # Funnel validation tab
│   │   │   ├── AttributionTab.tsx    # Attribution readiness tab
│   │   │   ├── RecommendationsTab.tsx# AI recommendations tab
│   │   │   ├── AlertCenterTab.tsx    # Alert center tab
│   │   │   ├── ActivityTab.tsx       # Real-time activity tab
│   │   │   └── RecommendationsPanel.tsx # Recommendations display
│   │   ├── /guides
│   │   │   ├── MetaGuide.tsx         # Step-by-step Meta connection guide
│   │   │   └── GoogleGuide.tsx       # Step-by-step Google connection guide
│   │   ├── /forms
│   │   │   └── CredentialInput.tsx   # Manual token input form
│   │   └── /tables
│   │       └── AuditIssuesTable.tsx  # Issues table for audit results
│   ├── /lib
│   │   ├── /api-clients
│   │   │   ├── meta.ts               # Meta Graph API client
│   │   │   └── google.ts             # Google APIs client
│   │   ├── /utils
│   │   │   └── healthScore.ts        # Health score calculations
│   │   └── /trpc
│   │       └── (routers - placeholder)
│   ├── /store
│   │   └── auth.ts                   # Zustand auth & credentials store
│   ├── /types
│   │   └── index.ts                  # TypeScript types and interfaces
│   ├── /styles
│   │   └── globals.css               # Global Tailwind styles
│   └── /worker
│       └── index.ts                  # Cloudflare Worker tRPC server
├── /public                           # Static assets
├── package.json                      # Dependencies and scripts
├── tsconfig.json                     # TypeScript configuration
├── tailwind.config.ts                # Tailwind CSS configuration
├── next.config.js                    # Next.js configuration
├── wrangler.toml                     # Cloudflare Worker configuration
└── CLAUDE.md                         # This file
```

---

## What's Been Built

### ✅ Phase 1: Foundation Complete
- Next.js 14 project initialized with TypeScript
- Tailwind CSS styling configured
- Git repository initialized
- All dependencies installed

### ✅ Phase 2: Landing Page & Onboarding
- Professional landing page with hero section
- Step-by-step connection guides for Meta and Google
- Manual token input form
- OAuth button structure (ready for implementation)
- Responsive design with dark theme

### ✅ Phase 3: Authentication & State Management
- Zustand store for credentials
- Support for Meta and Google credentials
- Date range selector (7d, 30d, 90d, custom)
- localStorage persistence with encryption-ready structure

### ✅ Phase 4: Dashboard Layout
- Main dashboard shell with sidebar navigation
- 8 tab sections ready for feature development
- Platform toggle (Meta, Google, Both)
- Date range selector
- User logout functionality

### ✅ Phase 5: Core Components
- Health Score Cards with color coding
- Audit Issues Table with sorting/filtering
- Recommendations Panel with priority levels
- Responsive grid layouts

### ✅ Phase 6: Health Score Logic
- Pixel health calculation algorithm
- Event Match Quality (EMQ) scoring
- Funnel health analysis
- Attribution readiness scoring
- CAPI health assessment
- Overall score aggregation
- Color-coded status indicators (Healthy/Moderate/Critical)

### ✅ Phase 7: API Client Foundations
- Meta API client class (methods stubbed)
- Google API client class (methods stubbed)
- Mock data for development
- tRPC router structure in worker

---

## How to Run Locally

```bash
# Install dependencies (already done)
npm install

# Start development server
npm run dev

# Open browser
open http://localhost:3000
```

The app will be available at `http://localhost:3000`. You can:
1. View the landing page
2. Click on "View Guide" to see Meta/Google connection guides
3. Click on "Manual Input" to add credentials (data persists in localStorage)
4. Navigate to dashboard once credentials are added

---

## Next Steps (Priority Order)

### 1. **Integrate Real Meta API** (High Priority)
   - Files: `src/lib/api-clients/meta.ts`
   - Replace mock data with actual Meta Graph API calls
   - Implement OAuth callback handling
   - Add pixel data fetching, EMQ analysis, CAPI validation

### 2. **Integrate Real Google APIs** (High Priority)
   - Files: `src/lib/api-clients/google.ts`
   - Implement Google Ads API integration
   - Implement GA4 Analytics API
   - Implement GTM API for container diagnostics

### 3. **Complete Dashboard Tabs** (Medium Priority)
   - Expand placeholder tab components with real data
   - Add charts and visualizations (use Recharts)
   - Implement filtering and date range logic
   - Add comparison tables for before/after metrics

### 4. **Deploy to Cloudflare** (Medium Priority)
   - Configure `wrangler.toml` with real database bindings
   - Deploy tRPC server to Cloudflare Workers
   - Set up D1 database schema
   - Configure environment variables

### 5. **Add Real-time Features** (Lower Priority)
   - Implement WebSocket connection via Durable Objects
   - Add real-time event streaming to Activity tab
   - Alert notifications on issue detection

### 6. **RunPod Integration** (Lower Priority)
   - Set up RunPod API client
   - Create Python workflows for AI analysis
   - Integrate anomaly detection and recommendations

---

## Key Files to Modify for Feature Development

| Feature | Primary Files | Related Files |
|---------|---------------|---------------|
| Meta Tracking | `meta.ts` → `PixelHealthTab.tsx` | `healthScore.ts` |
| Google Tracking | `google.ts` → `EventQualityTab.tsx` | `healthScore.ts` |
| Funnel Analysis | `meta.ts`, `google.ts` → `FunnelAuditTab.tsx` | `healthScore.ts` |
| Recommendations | `OverviewTab.tsx` → `RecommendationsTab.tsx` | `recommendationEngine.ts` (new) |
| Alerts | `AlertCenterTab.tsx` | `alertService.ts` (new) |

---

## Testing the Landing Page

The landing page is fully functional. Test it by:

1. **Landing Page Flow:**
   - ✓ View Meta connection guide (8 expandable steps)
   - ✓ View Google connection guide (7 expandable steps)
   - ✓ Input Meta credentials manually
   - ✓ Input Google credentials manually
   - ✓ Credentials persist in localStorage

2. **Dashboard Access:**
   - ✓ Add credentials → "Launch Dashboard" button appears
   - ✓ Click dashboard button → redirects to `/app/dashboard`
   - ✓ Overview tab shows health cards and mock data
   - ✓ Tab navigation works
   - ✓ Platform selector works
   - ✓ Date range selector works
   - ✓ Logout button clears credentials and redirects to landing

---

## API Response Structures (Reference for Implementation)

All types are defined in `src/types/index.ts`:
- `MetaPixelData` - Pixel status and metrics
- `EMQMetrics` - Event match quality scores
- `FunnelStage` - Conversion funnel stages
- `AuditIssue` - Issue tracking data
- `HealthScore` - Overall health assessment
- `Recommendation` - AI recommendations

---

## Development Notes

- **TypeScript:** Strict mode enabled (noUnusedLocals/noUnusedParameters disabled for faster development)
- **Styling:** All Tailwind classes, no external CSS libraries
- **State:** Zustand for global state (auth/credentials)
- **Components:** Functional components with hooks
- **API Strategy:** Real data will be fetched from API clients, mock data currently used for development

---

## Deployment

When ready to deploy:

```bash
# Build the Next.js app
npm run build

# Deploy Cloudflare Worker
npm run deploy:worker

# (Update environment variables in Cloudflare dashboard)
```

---

## Support & Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS](https://tailwindcss.com)
- [Zustand](https://github.com/pmndrs/zustand)
- [Meta Graph API Docs](https://developers.facebook.com/docs/graph-api)
- [Google Ads API Docs](https://developers.google.com/google-ads/api)
- [GA4 API Docs](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [tRPC Documentation](https://trpc.io/)

---

**Created:** May 21, 2026  
**Last Updated:** May 21, 2026  
**Status:** Ready for Development
