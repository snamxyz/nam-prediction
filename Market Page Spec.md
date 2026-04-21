# `/market/:marketId` — Page Design Spec

> Reference implementation: **Market Detail Page.html**
> Design system tokens: `NAM Prediction.html` (CSS `:root` block + `T` object)

---

## Route & Data

```
GET /market/:marketId
```

Fetch market data on load via `getMarket(marketId)`. All UI states below derive from the market object shape.

### Market object shape

```ts
type Market = {
  id: number
  type: 'price' | 'event'           // determines which stats/charts show
  question: string                   // displayed as page H1
  description: string                // shown in "About" tab
  tag: string                        // e.g. "Price", "Ecosystem"
  cadence: string                    // e.g. "15m", "daily"

  yesPrice: number                   // 0–1 (cents on the dollar)
  noPrice: number                    // 0–1; should sum to ~1
  volume: number                     // USD
  liquidity: number                  // USD

  endTime: string                    // ISO 8601
  resolved: boolean
  result?: 'YES' | 'NO'             // only if resolved

  // only for type = 'price'
  threshold?: number                 // e.g. 0.08542

  creator: string                    // wallet address (truncated)
  createdAt: string                  // human-readable e.g. "2h ago"
}
```

---

## Layout

Two-column grid, max-width 1280px, 24px horizontal padding.

```
┌─────────────────────────────────────────┬────────────┐
│  LEFT COLUMN  (flex: 1)                 │ RIGHT      │
│                                         │ COLUMN     │
│  [Header Card]                          │ 308px      │
│  [Chart Card]          (open only)      │ sticky     │
│  [Tabs: Trades / About]                 │ top: 70px  │
│                                         │            │
│                                         │ [Trade /   │
│                                         │  Resolved  │
│                                         │  Panel]    │
│                                         │            │
│                                         │ [Market    │
│                                         │  Info]     │
└─────────────────────────────────────────┴────────────┘
```

Gap between columns: `16px`.

---

## Components

### 1 — Header Card

**Always visible.** Contains:

#### Top row
- **Icon** — 42×42px, border-radius 11px, `bg: #01d24312`, `border: var(--border)`. Contains the NAM waveform SVG (`<polyline points="1,13 5,4 9,10 13,6 17,2 21,13" stroke=var(--accent)…>`).
- **Tag badge** — pill label with market tag (e.g. "Price"). Color: `accent` when open, muted when resolved. Font: Space Grotesk, 10px, 700, uppercase.
- **Live dot** (`animation: blink 2s`) — visible only when open.
- **Cadence label** — `"15m cadence"` in muted DM Mono 10px.
- **Question** — H1, 17px / 600, `text-wrap: pretty`, max-width 580px.
- **Countdown** (right-aligned, `flex-shrink: 0`):
  - Open: three-column HH / MM / SS display in DM Mono 28px/500. Labels: 8px/700/uppercase/muted.
  - Resolved: colored pill badge showing result `YES` / `NO`.

#### Stats row (below top row, separated by `border-top: 1px solid var(--border-s)`)

For `type = 'price'` markets, show:
- **Price to Beat** — DM Mono 18px, `$0.08542` format
- **Current Price** — live-updating, colored YES/NO by comparison to threshold. Includes delta badge (`▲ $0.00042` or `▼ $0.00032`).

Always show (right-aligned):
| Stat | Color |
|---|---|
| YES chance | `var(--yes)` |
| NO chance | `var(--no)` |
| Volume | `var(--text)` |
| Liquidity | `var(--text)` |

All values in DM Mono 14px/500. Labels 10px/700/uppercase/muted.

#### Probability bar
- Full-width, height 5px, below stats row. Left segment = YES (green), right = NO (red at 55% opacity).
- `transition: width 0.7s cubic-bezier(0.4,0,0.2,1)` on width change.

---

### 2 — Chart Card

**Visible only when market is open.** Two chart modes toggled by a pill segmented control:

#### Toggle
- Container: `background: var(--surface-h)`, `border: 1px solid var(--border)`, `border-radius: 8px`, inner padding 3px.
- Active button: `background: var(--text)`, `color: var(--bg)`.
- Inactive: `background: var(--surface-h)`, `color: var(--muted)`.

#### `NAM Price` chart
SVG chart rendering NAM/USDC price history (poll or subscribe every 12s). Key elements:
- Area fill: gradient from `currentColor @ 25%` opacity to transparent.
- Line: 2px, colored green if `price >= threshold`, red otherwise.
- **Threshold dashed line**: 1px, `stroke: var(--muted)`, `strokeDasharray: "5 4"`, with a "Target" label in a small box at the right edge.
- Y-axis: auto-computed ticks, values in `$0.00000` format.
- X-axis: time labels in `HH:MM` format.
- Live price dot: 4px radius, `stroke: var(--bg)` (2px).

#### `Probabilities` chart
SVG chart rendering YES probability history over the market's lifetime:
- Y-axis: `0%` – `100%` with `[0, 25, 50, 75, 100]` ticks.
- Line + area fill in `var(--yes)`.
- X-axis: time labels from market creation.

Both charts: `preserveAspectRatio="none"`, viewBox `0 0 800 200`. Left padding for Y labels: ~60px (price) / ~44px (prob). Bottom padding for X labels: 28px. Top: 14px. Right: 20px.

---

### 3 — Tabs

Two tabs: **Recent Trades** · **About**. Tab pill style: `border-radius: 20px`, `border: 1px solid var(--border)` when active, transparent when inactive.

#### Recent Trades tab
Table with columns: `Outcome · Trader · Shares · Amount · Time`

- Column widths: `110px · 1fr · 80px · 80px · 80px`
- Outcome badge: `"BUY YES"` / `"SELL NO"` etc. YES = green bg/text, NO = red bg/text. Font 9px/700/uppercase.
- Row dividers: `1px solid var(--border-s)`
- Trader: truncated wallet address in DM Mono 11px muted

#### About tab
- Description paragraph: 13px text, line-height 1.75
- Below: 2-column grid of info cells (`Market Creator`, `Created`, `Resolution Source`, `Market ID`). Each cell: `background: var(--surface-h)`, `border: 1px solid var(--border-s)`, `border-radius: 8px`, padding `12px 14px`.

---

### 4 — Trade Panel (right column, open markets)

Sticky at `top: 70px` (below navbar height 54px + 16px gap).

#### Header row
- **Buy / Sell toggle**: button group, `border: 1px solid var(--border)`, `overflow: hidden`. Active = `background: var(--text)`, `color: var(--bg)`.
- **Order type**: right-aligned, "Market ▾" dropdown trigger (display only, no logic required yet).

#### Outcome buttons
Two buttons side-by-side (`1fr 1fr`). Active state:
- YES: `background: var(--yes)`, `color: #000`
- NO: `background: var(--no)`, `color: #fff`

Inactive: `background: var(--surface-h)`, `color: var(--muted)`, `border: 1px solid var(--border)`.

Label: `"YES 52¢"` / `"NO 48¢"` (price in DM Mono).

#### Amount input
Full-width block with `$` prefix and number input right-aligned. `background: var(--surface-h)`. Placeholder: `"0"` in very low opacity.

#### Quick-amount buttons
Row: `+$1 · +$5 · +$10 · +$100 · Max`. Flex, gap 5px, each `flex: 1`. Hover: `color: var(--text)`.

#### Trade summary (visible when `amount > 0`)
Three rows inside a muted card:
- Avg price
- Est. shares
- Potential return — colored YES/NO, bold 700

#### CTA button
- **Not connected**: `background: #3b82f6`, `color: white`, `"Connect Wallet to Trade"`.
- **Connected, amount empty**: `background: var(--surface-h)`, `color: var(--muted)`, `"Enter an amount"`, `cursor: not-allowed`.
- **Connected, amount > 0**: `background: #3b82f6`, `color: white`, `"Buy YES · $10.00"` (active).

#### Footer
- `"By trading you agree to the Terms of Use"` — 10px, muted.
- Vault balance chip: `background: var(--surface-h)`, balance in `var(--yes)` DM Mono.

---

### 5 — Resolved Panel (right column, resolved markets)

Center-aligned card:
- `"MARKET RESOLVED"` label — 10px/700/uppercase/muted
- Large result text: `"YES"` or `"NO"` in DM Mono 52px/500, colored accordingly
- Icon in a 48px circle (checkmark or ×), colored bg at 18% opacity
- Short description + `"View Portfolio →"` button

---

### 6 — Market Info Card (below trade/resolved panel)

Always visible. Static metadata list:
`Yes price · No price · Volume · Liquidity · Created · Creator`

Each row: `display: flex; justify-content: space-between`. Bottom border `1px solid var(--border-s)` except last row. Font 12px, labels muted, values DM Mono.

---

## Design Tokens

```css
--bg:        #07080c
--surface:   #0d0e14
--surface-h: #111320
--border:    rgba(255,255,255,0.07)
--border-s:  rgba(255,255,255,0.04)
--yes:       #01d243
--no:        #f0324c
--text:      #e4e5eb
--muted:     #4c4e68
--accent:    #01d243
--r:         10px          /* default border-radius */
--font:      'Space Grotesk', sans-serif
--mono:      'DM Mono', monospace
```

---

## Responsive notes

- At < 900px viewport width, the right column (`308px`) should stack below the left column (single column layout).
- Chart should remain full-width with `preserveAspectRatio="none"`.
- Trade panel loses `position: sticky` and becomes inline.

---

## Animation

| Element | Animation |
|---|---|
| Page mount | `fadeUp` — `opacity: 0 → 1`, `translateY(8px → 0)`, 0.3s ease-out |
| Live dot | `blink` — opacity 1→0.25→1, 2s infinite |
| Prob bar fill | `transition: width 0.7s cubic-bezier(0.4,0,0.2,1)` |
| Buy/Sell toggle | `transition: all 0.12s` |
| Outcome buttons | `transition: all 0.14s` |

---

## Edge Cases

| State | Behavior |
|---|---|
| Market ended (not yet resolved) | Show "Ended" in countdown. Trade panel still shows but CTA is disabled. |
| Resolved YES | Right panel: Resolved Panel. Result badge = green YES. |
| Resolved NO | Right panel: Resolved Panel. Result badge = red NO. |
| `type = 'event'` | Hide "Price to Beat" and "Current Price" rows. Show chart in Probabilities mode only (or omit chart toggle). |
| Wallet not connected | Trade CTA = "Connect Wallet to Trade" (blue). |
| Sell mode, zero owned | Show `"0.00 YES shares"` muted in sell-mode header. |
