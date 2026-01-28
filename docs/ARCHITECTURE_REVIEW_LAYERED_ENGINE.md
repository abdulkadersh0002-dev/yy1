# Architecture Review: Layered Decision Engine

## Scope (مراجعة معمارية)
This document reviews the current layered decision engine and identifies logical weaknesses in:
- **Data Flow** (تدفق البيانات)
- **Logic** (المنطق)
- **Risk** (المخاطر)
- **Execution** (التنفيذ)

It also provides a staged plan for hardening trade management, liquidity analysis, and counter‑market handling.

---

## 1) Layered Decision Engine (18 Layers) — Current Flow

**Pipeline:**
1. **EA / RSS / Calendar ingestion** → `ea-bridge-service.js`, `rss-to-ea-bridge.js`
2. **Market context** → `scenario/index.js` builds EA market snapshot
3. **Analysis core** → `analysis-core.js` combines economics/news/technical
4. **Layered explainability** → `layered-analysis.js` builds 18 layers
5. **Execution gating** → `ea-bridge-service.js` + `intelligent-trade-manager.js`

**Strengths (نقاط قوة):**
- Strong multi-layer explainability (candles, liquidity sweep, volume imbalance).
- News blackout guard + EA news context.
- Learning-based risk adjustment for EA trade sizing.

**Weaknesses (نقاط ضعف منطقية):**
- Liquidity trap logic is best‑effort without explicit “fake move” detection.
- Trade management handles risk but lacks explicit “counter‑market regime detection”.
- Data flow mixes raw EA feeds with decision logic in a single path (tight coupling).

---

## 2) Logical Weaknesses (غير برمجية)

### A) Market Reading
**Issue:** Candle summaries detect trend/regime, but “fake breakout” logic is implicit.  
# Architecture Review: Layered Decision Engine

## Scope (مراجعة معمارية)
This document reviews the current layered decision engine and identifies logical weaknesses in:
- **Data Flow** (تدفق البيانات)
- **Logic** (المنطق)
- **Risk** (المخاطر)
- **Execution** (التنفيذ)

It also provides a staged plan for hardening trade management, liquidity analysis, and counter‑market handling.

---

## 1) Layered Decision Engine (18 Layers) — Current Flow

**Pipeline:**
1. **EA / RSS / Calendar ingestion** → `ea-bridge-service.js`, `rss-to-ea-bridge.js`
2. **Market context** → `scenario/index.js` builds EA market snapshot
3. **Analysis core** → `analysis-core.js` combines economics/news/technical
4. **Layered explainability** → `layered-analysis.js` builds 18 layers
5. **Execution gating** → `ea-bridge-service.js` + `intelligent-trade-manager.js`

**Strengths (نقاط قوة):**
- Strong multi-layer explainability (candles, liquidity sweep, volume imbalance).
- News blackout guard + EA news context.
- Learning-based risk adjustment for EA trade sizing.

**Weaknesses (نقاط ضعف منطقية):**
- Liquidity trap logic is best‑effort without explicit “fake move” detection.
- Trade management handles risk but lacks explicit “counter‑market regime detection”.
- Data flow mixes raw EA feeds with decision logic in a single path (tight coupling).

---

## 2) Logical Weaknesses (غير برمجية)

### A) Market Reading
**Issue:** Candle summaries detect trend/regime, but “fake breakout” logic is implicit.  
**Risk:** The system can enter late after a liquidity sweep.

### B) Liquidity Analysis
**Issue:** Liquidity layer (L5) relies on sweeps/order‑blocks without a dedicated “trap score.”  
**Risk:** A strong sweep can be misclassified as valid continuation.

### C) Entry Logic
**Issue:** Execution gates rely on strength/confidence thresholds without explicit “counter‑trend trap guard.”  
**Risk:** Inverse signal after strong trend may not down‑weight entry.

### D) Exit Logic
**Issue:** EA management handles partial close and trailing but no explicit loss‑avoidance when market flips quickly.  
**Risk:** The system reacts late to a reversal.

---

## 3) Recommended Separation (فصل Data/Logic/Risk/Execution)

**Data Layer**
- EA feeds + RSS + calendar ingestion.

**Logic Layer**
- 18‑layer analysis + trap detection + liquidity score.

**Risk Layer**
- News guard, liquidity guard, volatility guard, drawdown guard.

**Execution Layer**
- Smart entry/exit logic, trailing/partial close, stop loss protection.

---

## 4) Improvement Roadmap (مرحلي)

### Step 1 — Trade Management Logic
- Add explicit “counter‑market reversal guard” in trade management.
- Introduce small‑loss exit when volatility + reversal signals agree.

### Step 2 — Liquidity Trap Detection
- Add a **trap score** based on liquidity sweep + low follow‑through.
- Down‑weight entries if trap score is high.

### Step 3 — Layered Decision Engine
- Expose liquidity/trap output into 18‑layer metrics.
- Provide stronger “do not trade” reasons.

---

## 5) Next Actions (التنفيذ)
- Implement **trap score** into candle analysis output (liquidity layer).
- Extend EA management to handle **rapid reversal exits**.
- Add tests for trap score and exit guard behavior.
*** End Patch
