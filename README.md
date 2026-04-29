# MS Operations Hub

Operations dashboard for Mosquito Shield of Long Island. Deployed at https://ms-operations-hub.vercel.app.

Stack: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui. Deployed to Vercel.

## Sections

- `/sales` — pipeline, conversions, rep performance
- `/calling` — outbound call activity and outcomes
- `/combined` — cross-channel rollup

## Local development

```sh
npm install
npm run dev
```

App runs at http://localhost:3000.

## Environment

Create `.env.local` (not committed) with:

```
POCOMOS_USERNAME=
POCOMOS_PASSWORD=
POCOMOS_OFFICE=
POCOMOS_BASE=https://mypocomos.net
```
