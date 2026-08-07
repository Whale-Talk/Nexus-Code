import * as React from 'react'
import { Text } from '../../ink.js'

// Nexus ASCII logo (converted from 贺博团队 logo SVG)
// Design: per-row gradient. Each launch picks one neon palette at random
// (module-level seed = fixed for the whole session). Only the logo is loud —
// the rest of the UI stays calm.

const LOGO_RAW = String.raw`
                             :.
                             -:
                             +-
                             *=
                             #+      .
                    :--:.   .*+   . *#=
                 .=+-.      .**     .: :+-.
               .+*-         :+*.        .=*=.
              -#+.          -+*.          .*#:
             =%=            ==*:            +%-
            -%*             +-+-             #%:
            *%:             *-+=             -%=
           ::+              *:++             .+::
           #*.:+            #:=*           :+.:#+
           =#-**.          .#.=*           :#=+#:
           -+-:=+          :#.-#          .*=:=+:
           :##:*#.         -#.-#.         :%=-#*.
            :+=:-*-        =# :%:        ++::==.
             =#+:#%+      .## :%*      .*%+:*#-
              =%#=+%#-   -#@# .%@*:   =##==%#-
               :*%*=*= :*%@%+ .*%@%+. ++=*%+.
                 :++ .+%%#=:    :+#%#=..++.
                   .=##+:         .-+#*-.
                  :==:                :==.

.   .  .      .  .    .    .  .  .    .   ..    .  .   .. ..
+---=. =- =:-.=-.=-.--=- . =.-=.-:.-----=:--:- ---:=-::=-.==
`

// ── Neon palettes (3-4 hue stops each, no white mixed in) ──
const PALETTES: Record<string, string[]> = {
  cyber: ['#FF3CAC', '#8B5CFF', '#0066FF', '#00F5FF'],
  toxic: ['#D9FF00', '#00FF85', '#00E5FF'],
  sunset: ['#FFB000', '#FF3D00', '#FF006E', '#8B3DFF'],
  plasma: ['#FF00CC', '#B026FF', '#6236FF', '#008CFF'],
  fire: ['#FFE600', '#FF8A00', '#FF2D55'],
  arctic: ['#E8FFFF', '#00E5FF', '#0077FF'],
  alien: ['#B6FF00', '#00FFB3', '#7A5CFF'],
  monoRed: ['#FFFFFF', '#FF445F', '#FF0033'],
}

// Pick one palette per launch (module-level seed: stable for the session,
// different on every `nexus` restart).
const PALETTE_NAMES = Object.keys(PALETTES)
const PALETTE: string[] = PALETTES[PALETTE_NAMES[Date.now() % PALETTE_NAMES.length]!]!

const TEXT_COLOR = 'rgb(174,184,194)' // wordmark — solid gray, never gradient

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t)
  const g = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t)
  const bl = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t)
  return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`
}

// Row gradient: top row = first stop, bottom row = last stop.
function colorForRow(y: number, total: number): string {
  const t = (y / Math.max(total - 1, 1)) * (PALETTE.length - 1)
  const i = Math.min(Math.floor(t), PALETTE.length - 2)
  return lerpHex(PALETTE[i]!, PALETTE[i + 1]!, t - i)
}

export function NexusLogo(): React.ReactNode {
  const rows = LOGO_RAW.split('\n')
  const h = rows.length
  const isWordmark = (i: number) => i >= h - 3 // last 3 rows: "贺博团队" text
  return (
    <Text>
      {rows.map((row, i) => {
        if (isWordmark(i)) {
          return <Text key={i} color={TEXT_COLOR}>{row}{'\n'}</Text>
        }
        return (
          <Text key={i} color={colorForRow(i, h - 3)}>
            {row}
            {'\n'}
          </Text>
        )
      })}
    </Text>
  )
}
