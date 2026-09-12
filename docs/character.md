# The character

The orb is a character: a tile, the mark, and a face laid out inside the
mark's opening. This is its geometry and its manners, with the numbers that
felt right at the size it is drawn. Where a number is a point value it is for
a 56 pt tile; the code scales it from `ORB` in `shared/layout.ts`.

The mark is `renderer/bubble/logo.ts`, the face and its moods are
`renderer/bubble/face.ts`, the tile and the animations are `renderer/bubble/Orb.tsx`
and the orb section of `renderer/styles.css`, and the menu bar version is
`main/tray-mark.ts`.

## Three ideas

- **The tile is the fixed point.** The character sits where the student put
  it. The panel and the whisper open around it and close back to it.
- **A mood is lids, a gaze and a mouth.** Two eyes and a mouth are the whole
  vocabulary, so every state has to be said with those.
- **Another mark lays the face out from its own opening.** Give `logo.ts` a
  different path and opening rectangle and nothing in `face.ts` changes.

## Geometry

Everything is in a **100 unit box** that holds the D and the face. The box is
drawn at 90 percent of the tile, centred, so at 56 pt one unit is 0.504 pt.

**Tile.** A square, white, corner radius 22 percent of the side. No border and
no shadow of its own; the ring that marks listening or a lock-in sits 4 px
outside it and follows its corners.

**The D.** A linear gradient from top left `#14a3fa` to bottom right
`#0d4ff0`, one closed path:

```
M 22 26  L 34 12  L 56 12
C 107 12 107 88 56 88
L 28 88  L 28 48  L 40 48  L 40 74  L 56 74
C 84 74 84 26 56 26
Z
```

Clockwise from the top left: a cut corner up to the flat top, the outer bowl
with both control points at x 107, the flat bottom, the stem up to y 48 where
it stops so the opening is open to the left, then in to x 40, down, across,
and the inner bowl back up. The **opening** is `x 40, y 26, w 34, h 48`.

**Face**, ink `#171f33`, positioned from the opening:

- **Eyes**: capsules 7.5 by 11.5 at x 50 and x 64 (the opening's centre, plus
  and minus 7), y 43.28 (its top plus 36 percent of its height). Each carries a
  white highlight of diameter 2.6 at 95 percent, offset 1.4 left and 3 up.
- **Mouth**: a stroke 2 units wide, never thinner than 1.4 pt, round caps, in a
  15 by 8 frame centred at x 57, y 59.6 (the opening's top plus 70 percent).
  Four shapes: a small smile (quadratic from 0.2 w to 0.8 w at 0.35 h, control
  at 0.5 w, 1.0 h), a wide grin (0 to 1.0 w at 0.2 h, control at 1.7 h), a
  round "o" (an ellipse 0.32 w by 0.6 h), and a flat line (0.25 w to 0.75 w
  at 0.5 h).
- **Blush**: two dots of diameter 4, `#ff8094` at 75 percent, at x 46 and
  x 68, 3 units above the mouth's centre line. Celebrating only.

## Moods

What the companion knows about itself, read as a mood. Asleep is nothing to
hear and nobody talking to it.

| Mood | When | Eyes | Mouth | Tile |
|---|---|---|---|---|
| asleep | not listening, panel shut | lids to 45 percent | flat | 80 percent opacity, still |
| idle | panel open | centred, blinking | small smile | breathes |
| watching | listening | 2.7 left, 1 down, toward the lecture | small smile | breathes |
| thinking | a model call in flight | 2 right, 3 up | round "o" | pulses 1.0 to 1.05 every 0.8 s over the breath |
| cheering | a ship-it verdict, for 2.5 s | lids to 40 percent | wide grin | hops 10 px and springs back |
| celebrating | a lock-in, until the panel opens | squint, and the blush | wide grin | hops 15 px, and throws its outline outward as a ring |

The breath is scale 1.0 to 1.025 and back over 2.6 s, for as long as the tile
is awake. Open eyes blink every 2.5 to 5.5 s: lids to 12 percent for 110 ms,
80 ms in and out. Every mood change springs over 350 ms. The ring is the
tile's own rounded outline in the gradient, 3 units of stroke, scaled to 1.45
and faded to nothing over 0.9 s.

Hops are the notes' 12 and 18 pt at a 66 pt tile, scaled to this one. The
window leaves 16 px around the tile, which is what bounds them.

## The menu bar

The same D, with no face, as pixels rather than a file: a template image on
macOS, and a dark mark inside a light halo everywhere else. `tray-mark.ts`
fits the 100 unit box to 80 percent of the square and tests each pixel against
the bars, the stem and the two half ellipses of the bowl.
