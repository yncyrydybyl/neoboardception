# Presentation transitions

NeoBoard 3 organises the infinite canvas into frames, and the presentation
mode walks through them. This fork animates the way from one frame to the
next, in the spirit of Prezi (a zooming canvas) and Reveal.js (transition
styles, overview, progress, keyboard navigation). Everyone who follows the
presentation sees the same animation.

Slide mode boards (`REACT_APP_INFINITE_CANVAS=false`) keep their behaviour;
they only get the progress indicator and the extra navigation keys.

## What the presenter sees

"Start presentation" begins on the frame selected in the frame list. Without
such a selection it begins on frame 1 (the first frame of the path), with the
transition configured for frame 1. Where the view is panned or zoomed to does
not matter: the frame nearest to the view centre is no longer used.

The present bar (top right) has two new buttons while presenting on an
infinite canvas:

- **Show all frames** (grid icon): the overview. The camera zooms out until
  every frame is visible and numbers the frames. Arrow keys select another
  frame (followers see the selection), a click on a frame or Enter opens
  it.
- **Transitions** (also shown before the presentation starts):
  - _Between frames_: `Fly`, `Fade`, `Slide`, `Zoom` or `None`.
  - _Speed_: `Slow`, `Normal` or `Fast`.
  - _Into this frame_ (only while presenting): an override for the frame
    that is shown now, used whenever the presentation moves _into_ that frame
    (like `data-transition` on a Reveal.js slide). "Like all frames" removes
    the override.

A progress bar runs along the bottom edge and a label shows "3 of 7" (or
"Overview · 3 of 7"). It is shown to the presenter and to everyone who
follows.

### Keys

| Key                     | Action                     |
| ----------------------- | -------------------------- |
| → ↓ Page Down Space     | next frame                 |
| ← ↑ Page Up Shift+Space | previous frame             |
| Home / End              | first / last frame         |
| O, Escape               | show or close the overview |
| Enter (in the overview) | open the selected frame    |

The keys work for the presenter while no element is selected. In the
overview, the arrow keys only move the selection; the camera stays.

## Transition styles

| Style   | What happens                                                                                     | Used for                     |
| ------- | ------------------------------------------------------------------------------------------------ | ---------------------------- |
| `fly`   | The camera zooms out, pans and zooms in along a smooth path (default).                           | Prezi-like story telling     |
| `fade`  | The view fades out, the camera jumps, the next frame fades in.                                   | calm talks, reduced motion   |
| `slide` | The view slides out to the left and the next frame comes in from the right (reversed backwards). | slide-like decks             |
| `zoom`  | The view grows and fades, the next frame grows in from the distance (reversed backwards).        | "diving into" a detail frame |
| `none`  | The camera jumps, as before.                                                                     | live editing, slow devices   |

### The fly path

`fly` follows the "optimal" path of J. J. van Wijk and W. A. A. Nuij,
_Smooth and efficient zooming and panning_ (IEEE InfoVis 2003): for distant
frames the camera zooms out, travels and zooms in; for neighbouring frames it
mostly pans; the perceived speed along the path is constant. We use their
recommended trade-off ρ = √2 and put a cubic ease-in-out on the path
parameter, so the flight starts and lands softly.

The duration is proportional to the length of the path (650 ms per unit),
but at least 550 ms and at most 2.2 s at normal speed. `Slow` multiplies
the duration by 1.6, `Fast` by 0.6. Fades, slides and zooms take about
0.5 s (hide 220–260 ms, show 320–380 ms) times the same factor.

Opening and closing the overview always flies (or fades with reduced
motion), unless the presentation uses `none`.

Frames are not rotatable in NeoBoard, so the camera does not rotate. Rotated
content inside frames is shown as it is.

### Reduced motion

If the viewer's system asks for reduced motion
(`prefers-reduced-motion: reduce`), every moving transition (`fly`,
`slide`, `zoom`) is replaced by a `fade` on that viewer's screen. `fade` and
`none` stay as they are. This is decided per viewer: the presenter can fly
while a follower with reduced motion fades.

## How it works

### Settings in the board document

The transition, the speed and the per frame overrides are part of the board
document (the Yjs document that holds the elements), so every client renders
the same transition and the settings travel with the board:

```
presentation: {           // optional shared map at the root of the document
  transition: 'fly',      // fly | fade | slide | zoom | none
  speed: 'normal',        // slow | normal | fast
  'frame:<frameId>': 'zoom'  // one key per frame override
}
```

- The key is optional. Boards without it use `fly` and `normal`. No document
  version change and no migration is needed.
- The document schemas of NeoBoard allow unknown keys at the root, so older
  clients accept documents with settings (they just jump between frames).
- Unknown or invalid values (e.g. from a newer client) fall back to the
  defaults instead of rejecting the document.
- Overrides are flat `frame:<id>` keys with string values, so two people who
  change the overrides of different frames at the same time do not overwrite
  each other.
- Changing a setting is not part of the undo history (`performChange` with
  `undoable: false`), so Ctrl+Z only undoes drawing.

The settings are not part of the `.nwb` export yet.

### Presentation messages

The presenter still sends `net.nordeck.whiteboard.present_frame` messages to
the other sessions (WebRTC data channel or MatrixRTC). The view object has
two new optional fields; older clients ignore them:

- `overview: boolean`: the presenter shows the overview.
- `catchUp: boolean`: the message repeats the current view for a session
  that just connected. A follower that receives a catch-up message for a
  frame it is not showing jumps there instead of flying, so a late joiner
  does not watch a flight across the whole board. The next navigation of the
  presenter plays the transition as usual.

Followers compute the animation themselves from the same document settings
and the same frame geometry, so the presenter does not stream camera
positions. Only one message per navigation goes over the wire, and a slow
follower can never fall behind: a new target always starts from the camera
that is visible right now.

### Rendering

`usePresentationCamera` (in `components/Whiteboard/Presentation/`) replaces
the effect that used to move the viewport to the active frame. Outside of a
presentation, and when the window is resized, it still jumps as before. When
a presentation starts, the view always moves to the first shown frame, also
if that frame was already selected in the frame list before.

- **Fly**: `CameraTransitionPlayer` runs on `requestAnimationFrame` and writes
  the SVG `viewBox` of the canvas directly, without React renders. React's
  scale context gets the final camera once, at the end of the flight. The
  final camera is clamped exactly like the scale context clamps its
  translation, so there is no jump when the flight ends. A new navigation
  during a flight continues from the visible camera.
- **Fade, slide, zoom**: opacity and CSS transform of the canvas element,
  animated with the Web Animations API (compositor friendly). The camera
  jumps while the view is hidden.
- The camera state ("is moving") lives in its own small React context, so
  starting a flight does not re-render the elements of the board.
- Element bars and other HTML overlays are hidden while the camera flies.

### Embedded widgets

Live embedded widgets (iframes inside frames) keep running during every
transition; they are never reloaded. The existing rule "hide the widget while
the viewport changes" applies to flights only, and exactly for the duration of
the flight: the widget is paused (placeholder) when the flight starts and
shown again when the camera arrives, without the 150 ms gesture delay. Fades,
slides and zooms do not hide the widget at all; it fades and moves together
with the canvas.

## Tests

- Unit tests: camera math and the fly path (`camera.test.ts`), transition
  selection, reduced motion and keyframes (`transitions.test.ts`), the
  animation player with a manual frame clock (`CameraTransitionPlayer.test.ts`),
  document settings, defaults, invalid values, concurrent edits and undo
  (`presentation.test.ts`), key mapping (`presentationKeys.test.ts`),
  messages (`presentFrame.test.ts`), overview and catch-up in the
  presentation manager, the widget viewport hook (`viewport.test.ts`).
- Component tests: the present bar menu and overview button
  (`PresentBar.test.tsx`), the canvas camera with presenter, follower, late
  joiner, overview and reduced motion (`usePresentationCamera.test.tsx`).

## Possible next steps

- Step-by-step reveal of elements inside a frame (Reveal.js fragments),
  stored as an ordered list per frame in the same `presentation` map.
- Include the settings in the `.nwb` export.
- Transitions between slides in the slide mode.
- A custom path order that differs from the frame order.
