# Handoff: NAM Prediction Market — Full Site Redesign

## Overview

This is a full redesign of the NAM Prediction Market web app — a prediction market platform built on Base L2 where users trade YES/NO outcomes on NAM ecosystem milestones (price targets, volume goals, CEX listings, etc.). Markets use an on-chain Constant Product Market Maker (CPMM) and resolve automatically via DexScreener price feeds.

The redesign covers three pages: **Home (Markets list)**, **Market Detail + Trade Panel**, and **Portfolio**.

---

## About the Design Files

The files in this bundle (`NAM Prediction.html`) are **design references created in HTML** — high-fidelity interactive prototypes showing the intended look and behavior. They are **not production code to copy directly**.

Your task is to **recreate these designs in the existing Next.js + Tailwind codebase** (`apps/web/`) using its established patterns, hooks, components, and libraries. The prototype uses mock data and simulated state — replace all of that with the real API hooks already in the codebase (`useMarkets`, `useMarket`, `useMarketTrades`, `useVaultBalance`, `usePortfolio`, etc.).

---

## Fidelity

**High-fidelity.** The prototype is pixel-accurate with final colors, typography, spacing, interactions, and animations. Recreate it precisely using the existing Tailwind config and component patterns in the codebase.

---

## Design Tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#07080c` | Page background |
| `--surface` | `#0d0e14` | Card background |
| `--surface-h` | `#111320` | Elevated / hover card |
| `--border` | `rgba(255,255,255,0.07)` | Card borders |
| `--border-s` | `rgba(255,255,255,0.04)` | Subtle dividers |
| `--accent` / `--yes` | `#01d243` | Primary accent, YES outcome |
| `--no` | `#f0324c` | NO outcome |
| `--text` | `#e4e5eb` | Primary text |
| `--muted` | `#4c4e68` | Secondary / label text |

### Typography
| Role | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Body / UI | Space Grotesk | 13–22px | 400–700 | All labels, buttons, headings |
| Numbers / prices | DM Mono | 11–60px | 400–500 | All prices, volumes, wallet addresses, percentages |

Google Fonts import:
```
https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500&display=swap
```

### Spacing
- Page max-width: `1280px`, horizontal padding `24px`
- Card padding: `20–28px`
- Gap between cards/sections: `12–16px`
- Section margin-bottom: `24–28px`

### Border Radius
- Cards: `10px`
- Buttons: `8px` (primary), `6px` (small)
- Pill chips: `20px`
- Input fields: `8px`

### Shadows
- No box shadows on cards (flat aesthetic)
- Modal: `0 24px 64px rgba(0,0,0,0.7)`

---

## Screens / Views

---

### 1. Navbar (global)

**Layout:** `sticky top-0 z-50`, full width, height `54px`, flex row, `max-w-[1280px] mx-auto px-6`. Background `#07080cf2` + `backdrop-filter: blur(16px)`. Bottom border `1px solid rgba(255,255,255,0.07)`.

**Contents (left → right):**

1. **Logo** — SVG polyline chart icon in `#01d243` + "NAM" bold 14px + "Predict" muted 11px. Navigates home on click.

2. **Nav links** — "Markets" and "Portfolio". Active state: `background: #111320`, text `#e4e5eb`. Inactive: transparent bg, text `#4c4e68`. `padding: 6px 13px`, `border-radius: 7px`.

3. **NAM price chip** — Flex row: pulsing green dot + "NAM/USDC" muted + live price in DM Mono 12px. Price color: green if up, red if down vs previous tick. Background `#111320`, border `rgba(255,255,255,0.07)`, `padding: 5px 12px`, `border-radius: 7px`. Polls/simulates price drift every ~3s.

4. **Wallet button:**
   - **Disconnected:** "Connect Wallet" — `background: #01d243`, `color: #000`, `font-weight: 700`, `padding: 7px 16px`, `border-radius: 8px`.
   - **Connected:** Shows truncated address (`0x1a2b…3c4d`) with green dot. `background: #0d0e14`, `border: 1px solid rgba(255,255,255,0.07)`, DM Mono 12px.

---

### 2. Home Page

**Route:** `/` — maps to existing `page.tsx`

**Layout:** `max-w-[1280px] mx-auto px-6 py-8`

#### 2a. Page Header
```
"Prediction Markets"   — 22px, weight 600, #e4e5eb, letter-spacing -0.025em
"Trade on NAM ecosystem milestones..."  — 13px, #4c4e68
```

#### 2b. Stats Bar
4-column grid, gap `10px`, margin-bottom `28px`. Each card: `padding: 14px 18px`.

| Stat | Value source |
|---|---|
| Total Volume | Sum of all `market.volume` |
| 24h Volume | `totalVolume * 0.12` (placeholder ratio) |
| Open Markets | Count of unresolved markets |
| NAM Price | Live from DexScreener / `fetchNamPrice()` |

Card label: 10px, `#4c4e68`, uppercase, `letter-spacing: 0.07em`, weight 700.  
Card value: DM Mono 21px, weight 500, `#e4e5eb` (NAM Price uses `#01d243`).

#### 2c. 1-Hour Market Hero

Full-width card (`padding: 28px`), subtle radial glow behind YES side (`#01d24307`) and NO side (`#f0324c05`).

**Top row:** Pulsing green dot + "1-HOUR MARKET" label (10px, uppercase, `#4c4e68`, `letter-spacing: 0.1em`) | countdown timer right-aligned (DM Mono 11px, `#4c4e68`).

**Question:** 20px, weight 600, `#e4e5eb`, `max-width: 700px`, `text-wrap: pretty`.

**Large probability split display** — 3-column grid `1fr 1px 1fr`:
- Left: YES side with `background: #01d24309`, center-aligned. Number: DM Mono **60px** weight 500 `#01d243`. Label below: "YES %" 11px uppercase muted.
- Divider: 1px `rgba(255,255,255,0.07)`, `margin: 12px 0`.
- Right: NO side with `background: #f0324c07`. Number: DM Mono **60px** weight 500 `#f0324c`. Label: "NO %".

**Probability bar:** 4px height, green fill (YES%) + red remainder (NO%), `border-radius: 4px`.

**Footer row:** Left — volume/price meta (10px labels + DM Mono 13px values). Right — "Trade Now →" button: `background: #01d243`, `color: #000`, `font-weight: 700`, `padding: 10px 22px`, `border-radius: 8px`.

#### 2d. Market Card Grid

Tab filters above grid: "All Markets" / "Open" / "Resolved". Active tab: `background: #111320`, border `rgba(255,255,255,0.07)`, text `#e4e5eb`. Pills with `border-radius: 20px`.

Grid: `grid-template-columns: repeat(auto-fill, minmax(290px, 1fr))`, gap `12px`.

**Each MarketCard:**
- Hover: background → `#111320`, border → `rgba(255,255,255,0.12)`, transition 0.14s.
- Question: 13px weight 500, `#e4e5eb`, `line-height: 1.55`, margin-bottom `18px`.
- **Split probability block:** Same pattern as hero but smaller — DM Mono 26px. Split into YES left / NO right with `border-radius: 8px`, inner border. YES bg `#01d24309`, NO bg `#f0324c07`.
- Probability bar: 3px height.
- Footer row: volume (DM Mono 11px muted) | countdown or "YES/NO resolved".

---

### 3. Market Detail Page

**Route:** `/market/[id]`

**Layout:** 2-column grid `1fr 340px`, gap `14px`. Left column `display: flex flex-col gap-3`. Right column `position: sticky top-[68px]`.

#### 3a. Back button
"← Back to Markets" — 13px, `#4c4e68`. Hover → `#e4e5eb`. `background: none`.

#### 3b. Header Card
- Question: 19px weight 600, `#e4e5eb`, `text-wrap: pretty`.
- Status chip (top-right): countdown in styled chip (live dot + DM Mono time) OR "YES/NO RESOLVED" badge.
- **Large probability split:** Same pattern as hero but 48px numbers, `padding: 18px 24px`, inside a rounded bordered container.
- Probability bar: 4px height.
- Meta row below bar: Volume / Last trade / Liquidity / Fee — each as a labeled stat (10px label, DM Mono 13px value).

#### 3c. Chart Card
- Title "YES PRICE HISTORY" — 11px, uppercase, `letter-spacing: 0.08em`, `#4c4e68`.
- SVG area chart: YES probability over time. Line color `#01d243`, area fill gradient `#01d24318 → transparent`. 80px tall. Y-axis labels (left, 32px padding). X-axis time labels below.
- Uses `trades` array ordered by timestamp. Plot `(t.yesPrice ?? 0.5) * 100` for each trade.

> **Implementation note:** Replace `<Spark>` SVG with Recharts `<LineChart>` (already used in `PriceChart.tsx`). Match exact styling: no grid by default, `stroke: #01d243`, `strokeWidth: 1.5`, area fill gradient, dot on last point.

#### 3d. Recent Trades
- Section label: 11px uppercase muted.
- Each row: `padding: 10px 0`, bottom border `rgba(255,255,255,0.04)`.
- Left: colored badge (BUY YES / SELL NO etc.) + truncated address in DM Mono 11px.
- Right: `$amount` in DM Mono 12px + "Xm ago" in 10px muted.
- Badge colors: BUY YES → `#01d24318` bg `#01d243` text; BUY NO → `#f0324c15` bg `#f0324c` text; SELL → `rgba(255,255,255,0.05)` bg muted text.

#### 3e. Resolved state (right column)
When `market.resolved`: Show card with "Market Resolved" label + giant YES/NO in 40px DM Mono in accent color + "Go to Portfolio" instruction.

---

### 4. Trade Panel

**Used in:** Market Detail right column (when market is open).

**Card structure:** Header row (title + balance) / Body with padding `20px`.

#### Controls (top → bottom):

1. **BUY / SELL toggle** — 2-col grid, gap `6px`. Active BUY: `#01d24322` bg, `#01d243` text, green border. Active SELL: `#f0324c22` bg, `#f0324c` text. Inactive: `#111320` bg, `#4c4e68` text.

2. **YES / NO toggle** — Same pattern. Shows price in DM Mono 11px alongside label. e.g. "YES 52.4¢".

3. **Amount input** — `$` prefix (BUY mode), right-aligned value, `background: #111320`, `border: 1px solid rgba(255,255,255,0.07)`, DM Mono, `font-size: 14px`.

4. **Quick add buttons** — +$1, +$5, +$10, +$100, Max. Each `flex: 1`, `border-radius: 6px`, hover: text → `#e4e5eb` + border → `rgba(255,255,255,0.07)`.

5. **Slippage selector** — Inline row of 0.5% / 1% / 2% / 5% pill buttons. Active: `#01d24320` bg, `#01d243` text, green border.

6. **Breakdown box** — `background: #111320`, `border-radius: 8px`, `padding: 13px 15px`. Shows: Avg price / Est. shares / divider / "If YES/NO wins: $X.XX (+XX%)". Profit in side color when amount > 0.

7. **CTA button:**
   - Unauthenticated: "Connect Wallet to Trade" — `#01d243` bg, `#000` text.
   - No amount: "Enter an amount" — `#111320` bg, muted text, `cursor: not-allowed`.
   - Ready: "BUY YES · $10.00" — YES color bg (`#01d243`, black text) or NO color bg (`#f0324c`, white text).

8. **Disclaimer** — 10px centered, very muted: "Each trade requires a wallet signature."

---

### 5. Portfolio Page

**Route:** `/portfolio`

**Unauthenticated state:** Centered card with connect prompt.

**Layout:** Same max-width / padding as Home.

#### 5a. Summary row
3-column grid: Portfolio Value / Total P&L (green) / Open Positions count. Same card style as stats bar.

#### 5b. Positions table
Full-width card. Column grid: `1fr 64px 80px 80px 84px 84px`.

Headers: Market / Side / Shares / Avg Price / Value / P&L — 10px, uppercase, `#4c4e68`, `letter-spacing: 0.07em`.

Each row:
- Hover: `background: #111320`.
- Market: question text 13px + optional "REDEEMABLE" badge (9px, `#01d24315` bg, `#01d243` text).
- Side: "YES" in `#01d243` or "NO" in `#f0324c`, DM Mono 12px weight 700.
- Shares, Avg Price, Value: DM Mono 12px `#e4e5eb`.
- P&L: DM Mono 12px weight 700, green if positive, red if negative. Prefix `+` for positive.

#### 5c. Vault card
Shows current USDC balance in DM Mono 30px `#01d243`.

**Deposit button:** `#01d243` bg, `#000` text, weight 700.  
**Withdraw button:** `#111320` bg, border, `#e4e5eb` text.

Both open the **Vault Modal** (see below).

---

### 6. Vault Modal (Deposit / Withdraw)

Triggered by Deposit / Withdraw buttons in Portfolio.

**Overlay:** `position: fixed; inset: 0; z-index: 400; background: rgba(0,0,0,0.6); backdrop-filter: blur(6px)`. Click outside to close.

**Modal card:** `width: 360px`, `padding: 28px`, centered, `box-shadow: 0 24px 64px rgba(0,0,0,0.7)`.

**Contents:**
- Header: "Deposit USDC" or "Withdraw USDC" (15px weight 600) + `×` close button (right).
- Balance chip: "Wallet Balance / Vault Balance" label + value in DM Mono 12px. `background: #111320`, `border-radius: 8px`, `padding: 10px 14px`.
- Amount input: `$` prefix, right-aligned, DM Mono 15px. **MAX** button inside input (right side): `font-size: 10px`, colored bg chip.
  - Error state: red border if amount > available balance.
- Quick amounts: $10 / $50 / $100 / $500 — same quick button style as trade panel.
- CTA button: "Deposit $X.XX" or "Withdraw $X.XX". Green bg for deposit, red bg for withdraw. Disabled when no amount or exceeds balance.
- Footer note: 10px muted ("Funds arrive in your vault instantly." / "Withdrawal sent to your connected wallet.").

---

## Interactions & Behavior

| Interaction | Behavior |
|---|---|
| Click market card | Navigate to `/market/[id]` |
| Click "Trade Now" on hero | Navigate to `/market/1` (current hourly market) |
| Click row in portfolio | Navigate to `/market/[id]` |
| BUY/SELL toggle | Clears amount + estimate |
| Amount input | Debounced 300ms → calls `GET /trading/estimate-buy` or `estimate-sell` |
| Quick add buttons | Adds to current amount |
| MAX button | Sets amount to full vault balance |
| Connect Wallet | Triggers Privy login |
| Trade button | Signs EIP-712 typed data → POST `/trading/buy` or `/trading/sell` |
| Deposit / Withdraw | Opens modal; on confirm updates vault balance |
| Close modal | Click overlay or `×` |
| Navbar NAM price | Polls live price every 3s; color flips green/red based on direction |

### Animations
| Element | Animation |
|---|---|
| Page transition | `fadeUp`: `opacity 0→1, translateY 10px→0`, 0.35s ease-out |
| Live dot | `blink`: opacity 1→0.3→1, 2s ease-in-out infinite |
| Probability bar fill | `width` transition 0.7s `cubic-bezier(0.4, 0, 0.2, 1)` |
| Card hover | `background` + `border-color` transition 0.14s |
| Modal toggle | Conditional render (no animation needed, backdrop blur handles it) |

---

## State Management

Replace all mock state with existing hooks:

| Mock state | Real hook |
|---|---|
| `MARKETS` | `useMarkets()` |
| `market` in detail | `useMarket(id)` |
| `TRADES` | `useMarketTrades(id)` |
| `vaultBalance` | `useVaultBalance()` → `usdcBalance` |
| `PORTFOLIO` | `usePortfolio()` |
| Live prices/socket | `useMarketSocket(market.id)` |
| `connected` | `useAuth()` → `isAuthenticated` + `useAccount()` |

The `TradePanel` component already exists at `apps/web/src/components/TradePanel.tsx` — **restyle it** to match this design rather than rewriting from scratch.

---

## Component Mapping

| Design component | Existing file to update |
|---|---|
| Navbar | `apps/web/src/components/Navbar.tsx` |
| Home page | `apps/web/src/app/page.tsx` + `HourlyMarketHero.tsx` |
| StatsBar | `apps/web/src/components/StatsBar.tsx` |
| MarketCard | `apps/web/src/components/MarketCard.tsx` |
| Market detail | `apps/web/src/app/market/[id]/page.tsx` |
| PriceChart | `apps/web/src/components/PriceChart.tsx` |
| TradePanel | `apps/web/src/components/TradePanel.tsx` |
| Portfolio | `apps/web/src/app/portfolio/page.tsx` |
| VaultModal | New component: `apps/web/src/components/VaultModal.tsx` |
| DepositWithdrawPanel | `apps/web/src/components/DepositWithdrawPanel.tsx` (already exists — refactor) |

---

## CSS Changes

Replace `apps/web/src/app/globals.css` with these updated tokens:

```css
:root {
  --background: #07080c;
  --foreground: #e4e5eb;
  --accent: #01d243;
  --muted: #4c4e68;
  --surface: #0d0e14;
  --surface-hover: #111320;
  --border: rgba(255,255,255,0.07);
  --border-subtle: rgba(255,255,255,0.04);
  --yes: #01d243;
  --no: #f0324c;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: 'Space Grotesk', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

Update `tailwind.config.js` to expose these as Tailwind classes:
```js
colors: {
  bg: '#07080c',
  surface: '#0d0e14',
  'surface-h': '#111320',
  accent: '#01d243',
  yes: '#01d243',
  no: '#f0324c',
  muted: '#4c4e68',
}
```

Add `DM Mono` and `Space Grotesk` to the font config.

---

## Files in This Package

| File | Description |
|---|---|
| `NAM Prediction.html` | High-fidelity interactive prototype — all 3 pages + trade panel + vault modal |
| `README.md` | This document |

Open `NAM Prediction.html` in a browser to interact with the full prototype. All navigation, trade panel calculations, vault modal, and live NAM price simulation are functional.
