# UNSLOP-AUDIT — controls + residual pulse/glow

Дата: 2026-11-10  
Skill: `heydamir/unslop` (CC BY 4.0) → `~/.agents/skills/unslop`, `~/.cursor/skills/unslop`, `.claude/skills/unslop`  
Character: `steel, exact, cold-warm gold`

## Direction

- **Product.** ASGARD CRM — внутренний контур управления тендерами, работами, людьми.
- **Character.** steel, exact, cold-warm gold.
- **World.** цех / приборная панель / холодный металл с тёплым золотом.
- **Moments.** золотой on-state switch; solid gold checkbox mark.
- **Signature.** elastic thumb stretch на press (≤260ms ease-out).

## Controls package

| Sign | Status |
|------|--------|
| Glow checkbox / blue-green switches / emoji-× chrome | fixed |
| Call-toggle галочка поверх трека | fixed (`no-cr-chk`) |

## Residual pass (100%)

Убраны декоративные `infinite` pulse/glow/float/aurora/bounce/orb/shine в vanilla + mobile src (не Huginn, не v2).

| Зона | Что сняли |
|------|-----------|
| call / telephony / phone | `callGlow`, ring pulse |
| mimir / ncm / tkp-ai | `ncmMimirPulse`, avatar bob/shimmer, btn shimmer, `tkpaiPulse` |
| welcome / splash / logo | aurora, float, orb, core pulse, ring spin |
| kanban / billing / mail / birthday / payout / ting-tv | decorative KPI/status pulse |
| gamification / field leaderboard / shop | gold-pulse, crown-bob, champion glow, shine |
| spring overshoot | `cubic-bezier(.34,1.56,…)` → ease-out |

**Оставлены намеренно** (живой affordance / loader):

- typing/thinking dots (`TypingIndicator`, `Mimir`, `mimirDotBounce`, `mimirThinkPulse`)
- skeleton / shimmer / spin loaders
- QR `scanline` (без glow) — индикатор сканера

## Gate

| Check | Result |
|-------|--------|
| Decorative infinite pulse/glow (excl. keep-list) | **0** (`tmp-gate-residual.py` + `tmp-gate-other.py`) |
| Huginn / React v2 | не трогали |
| Mobile build | `npm run build` OK → `public/m` |
| Commit / deploy | **не делали** — ждут команду |

## Attribution

unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.
