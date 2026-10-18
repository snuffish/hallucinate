# Research: driving DMX fixtures from Hallucinate

Status: research only. No code has changed. Written 2026-10-18.

Question: how can Hallucinate's show also drive DMX512 lighting fixtures, so that a fixture rig (and DMX-controlled
lasers) moves with the same music as the projectors?

Every claim about the code has a `file:line`. Every claim about the outside world links to its primary source
(the spec, the vendor's own document, or the library's source code or README).

---

## 1. What Hallucinate is today

### Runtime

- It is a **browser app** (React + Vite, WebGL2), and the web demo runs on GitHub Pages
  (`package.json:1-14`, `docs/desktop.md` "Web demo"). It has a **local Node server** for the parts a browser can't do:
  the `/api` routes (`server/routes.ts:23-36`), mounted as Vite middleware in `dev`/`preview`
  (`vite.config.ts:9-14`) and by the desktop app's own HTTP server (`desktop/server.ts:57`, `:98`).
- The **desktop app is Electron** (`package.json` `"main": "dist-desktop/main.js"`, `desktop/main.ts`). Its renderer
  is a plain sandboxed web page: `contextIsolation: true, nodeIntegration: false, sandbox: true`
  (`desktop/main.ts:130-132`). There is no preload script and no IPC. So **even in Electron the app code has no Node
  APIs**. Anything that needs Node (serial ports via `serialport`, UDP via `dgram`) must run in the main process or in
  the local server, and the page reaches it over HTTP like the browser does.
- Electron grants only a fixed set of permissions (`desktop/main.ts:20`, `:87-109`). `serial` and `usb` are not in it.
- The static web demo has **no server** (`src/app/static-demo.ts:1-2`). Any Node-side DMX path would not exist there.

### How a frame is made (the "compose every output's frame" design)

1. Once a frame, the **Listener** gives the **Hearing**: bands, kick, tick, tick phase, tempo, tone, energy and mood
   (`src/engine/listener.ts:32-47`). This happens in `Controller.step` (`src/app/controller.ts:916`), driven by
   `requestAnimationFrame` (`src/app/controller.ts:229`, `:893`).
2. `composeFrame` turns the Hearing plus a **Look** into a `ProgramState`: reactivity-scaled bands and beat, the
   music's clock, the hue walk (colour cycling, kick jumps), the synesthesia grade, trails and fringing
   (`src/engine/look.ts:36-66`). `ProgramState` is plain data that is documented as travelling to projector windows
   (`src/engine/renderer.ts:81-108`). It also carries `master` (the studio's master fader, `0` = blackout:
   `src/app/controller.ts:934`, `src/app/studio.ts:140`, `:460-466`, applied in the shader at
   `src/engine/renderer.ts:55`, `:72`).
3. `LiveSlot.route()` decides what each output gets this frame. When a show scene is pinned, projectors get **Live**
   (composed with the show scene's own Look and effects). Otherwise they get the main program
   (`src/app/live-slot.ts:106-114`).
4. The controller draws the screen and, **if a projector is connected**, posts the projector frame
   (`src/app/controller.ts:938-941`). `OutputLink.sendFrame` sends it over a `BroadcastChannel` to every projector
   window (`src/engine/output-link.ts:121-123`, `:27-36`). Each projector window renders it with its own `Renderer`
   (`src/output.ts:1-33`).

Domain terms (from `GLOSSARY.md`): the **scene** is the moving picture, an **effect** reshapes it, the **Look** colours
it and sets how it reacts, a **show scene** is what the studio plays, **Live** is what the audience sees, and a
**take** puts the Preview on Live. Kicks and ticks come from the music. The glossary says to avoid "output" for Live;
below, "output" means only the code's `OutputLink`/projector plumbing.

### What matters for DMX

- **The colour is not in `ProgramState` as RGB.** Scenes colour their lines in GLSL from the **laser palette**,
  `laser(t)` with `t` near `uHue` (`src/scenes/header.ts:25-27`, `src/engine/nodes.ts:43`). A DMX feed would have to
  compute the same colour on the CPU from `program.hue`. That formula is one line, so it ports directly.
- **The picture itself is GPU-only.** Getting pixels back is an async PBO plus fence readback that the app uses for
  thumbnails and stills (`src/engine/renderer.ts:561-590`). So sampling Live's picture for pixel-mapping (LED bars) is
  possible, but it costs extra per frame. Driving fixtures from the **parameters** (hue, beat, bass, tick phase,
  master) is free.
- **The frame loop runs at the display rate.** DMX can't refresh that fast (section 2). A DMX sender must keep the
  newest universe and send it on its own clock.
- **Safety rules exist for the picture, not for fixtures.** The scenes are strobe-safe, defined as "no change from one
  frame to the next makes more than a quarter of the frame over twice as bright more than 3 times a second"
  (`docs/scenes.md:10-11`), and the Look is checked against those rules (ADR 0002). A fixture's strobe or shutter
  channel bypasses all of that, so a DMX mapping needs its own limit. ADR 0003 makes the same argument for effects:
  only built-in, pre-checked behaviour is allowed.

---

## 2. DMX512 in brief

- **One universe is one link with up to 512 data slots.** "Each data link shall support up to 512 data slots. Multiple
  links shall be used where larger numbers of slots are required." Shorter packets are allowed. Each packet is
  BREAK, MARK AFTER BREAK, then a START code (slot 0, `0x00` for dimmer data) and the slots. Source: ANSI E1.11-2008
  (R2018) §8.6–8.9, https://tsp.esta.org/tsp/documents/docs/ANSI-ESTA_E1-11_2008R2018.pdf
- **Timing, transmitter side (E1.11 Table 6):** 250 kbit/s (4 µs per bit), BREAK at least 92 µs (typical 176 µs), MAB
  at least 12 µs, and break-to-break at least 1204 µs, up to 1 s. A full 513-slot packet takes 22.7 ms, which gives
  a **maximum refresh of 44 updates/s**. Same source, Table 6.
  - Note: that PDF is now marked *superseded*. ESTA lists **E1.11-2024** as current (approved 2024-04-25) and as a free
    download (https://tsp.esta.org/tsp/documents/published_docs.php). I could not fetch the 2024 text directly. The
    numbers above come from the 2008 (R2018) edition. Check them against 2024 before relying on any edge value.
- **Holding the last frame:** the maximum time between breaks is 1 s (Table 6, designations 11 and 13). So a sender
  should keep re-sending even when nothing changes. Art-Net's guidance says the same (section 4).

## 3. USB-to-DMX interfaces

### ENTTEC DMX USB Pro: the widget times DMX itself

Source: ENTTEC "DMX USB Pro – API" v1.44, https://cdn.enttec.com/pdf/assets/70304/70304_DMX_USB_PRO_API.pdf

- It shows up as an **FTDI virtual COM port**. "the baud rate setting used to open this COM port is a dummy value and
  does not control the USB communication speed."
- **Message framing:** `0x7E` start, 1-byte **label**, data length LSB and MSB (0 to 600), data, `0xE7` end.
- **Label 6, "Output Only Send DMX Packet Request":** the data is the start code plus 24 to 512 slots (25 to 513
  bytes). The widget "periodically send[s] a DMX packet … at the configured DMX output rate" until it gets a different
  request. So the host only sends when the universe changes. It does not have to keep the line alive itself.
- **Label 4, "Set Widget Parameters":** break time and MAB in 10.67 µs units, and an output rate of 1–40 packets/s
  (or 0 for as fast as possible).
- ENTTEC's product page lists 1 universe, 1500 V isolation, up to 40 fps, and "an internal frame buffer for consistent
  DMX generation":
  https://www.enttec.com/product/dmx-usb-interfaces/dmx-usb-pro-professional-1u-usb-to-dmx512-converter/

**Pro-compatible devices.** The `dmx` npm library's `enttec-usb-dmx-pro` driver supports "devices using a Enttec USB
DMX Pro chip like the 'DMXKing ultraDMX Micro'". It has a separate `dmxking-utra-dmx-pro` driver for the two-port
DMXking Ultra DMX Pro (https://github.com/node-dmx/dmx#readme). The driver's source shows the same framing, `0x7e`,
label `0x06`, `0xe7`
(https://github.com/node-dmx/dmx/blob/master/drivers/enttec-usb-dmx-pro.js).

### ENTTEC Open DMX USB and generic FTDI clones: the host times DMX

- ENTTEC's page describes it only as using "the widely compatible FTDI driver", with D2XX-based examples. It drives
  1 universe and is "NON ISOLATED" (https://www.enttec.com/product/dmx-usb-interfaces/open-dmx-usb/). ENTTEC's page
  doesn't spell out the internal design.
- The host's software has to produce every BREAK and every frame. The `dmx` library's driver does this. It opens the
  port at 250000 baud, 8 data bits and 2 stop bits. On a `setInterval` (46 ms by default) it raises `brk`, waits
  about 1 ms on `setTimeout`, drops it, waits again, then writes the 513 bytes
  (https://github.com/node-dmx/dmx/blob/master/drivers/enttec-open-usb-dmx.js). Its README warns: "This device is NOT
  recommended, there are known hardware limitations and this driver is not very stable"
  (https://github.com/node-dmx/dmx#readme).
- Conclusion: an Open DMX dongle can be made to work, but break timing depends on the OS and on JS timer jitter. This
  is a poor fit for a page that already runs a 60 fps WebGL loop.

## 4. DMX over the network

### Art-Net 4

Source: Artistic Licence, *Art-Net 4 Specification*, Release V1.4, Document Revision 1.4dp (23/10/2025),
https://art-net.org.uk/downloads/art-net.pdf

- **One UDP port, 0x1936 (6454),** used as both source and destination.
- **ArtDmx (OpCode `OpOutput`/`OpDmx` = 0x5000, low byte first):** `"Art-Net\0"`, OpCode, ProtVerHi/Lo (14),
  Sequence (0x01–0xff, or 0 to disable), Physical, SubUni (low byte of the 15-bit Port-Address), Net (top 7 bits),
  Length (big-endian, **even, 2–512**), then the data.
- **Unicast only:** "ArtDmx packets must be unicast to subscribers of the specific universe … There are no conditions
  in which broadcast is allowed". The controller should ArtPoll to find subscribers. Many older libraries broadcast,
  which this revision now forbids.
- **Rate:** a DMX512 gateway accepts at most **44 Hz**. Nodes re-transmit their last frame when no new ArtDmx arrives.
  The spec recommends a 800–1000 ms keep-alive. ArtSync exists for keeping several universes in sync.

### sACN (ANSI E1.31)

- ESTA lists **E1.31-2025** as current (approved 2026-01-05) and free to download
  (https://tsp.esta.org/tsp/documents/published_docs.php). I couldn't fetch the PDF directly. The values below come
  from ETC's open-source reference implementation of E1.31 instead.
- **UDP port 5568** (`kSacnPort = 5568`) and **universes 1–63999** (`kSacnMaximumUniverse = 63999`).
  https://github.com/ETCLabs/sACN/blob/main/src/sacn/private/common.h ,
  https://github.com/ETCLabs/sACN/blob/main/include/sacn/common.h
- **Multicast address per universe:** IPv4 `0xEFFF0000 | universe`, which is **239.255.{hi}.{lo}**
  (https://github.com/ETCLabs/sACN/blob/main/src/sacn/sockets.c, around line 773).
- Receivers treat a source as lost after **2.5 s** without data (`kSacnSourceLossTimeout = 2500`, same `common.h`), so
  the sender must keep re-sending.
- sACN carries a per-source **priority** (0–200) for merging with a lighting desk on the same universe
  (https://github.com/k-yle/sACN#readme). That is useful if Hallucinate shares a universe with a console.

### The browser can't send either one

Art-Net and sACN are UDP. Web pages can't open UDP sockets. The Direct Sockets API that would allow it "is planned to
be available only in Isolated Web Apps" (https://github.com/WICG/direct-sockets/blob/main/docs/explainer.md). So
network DMX has to go through Node, which here means the local server or Electron's main process.

## 5. Reaching the hardware from this app

| Path | Where it runs | Works in | Notes |
|---|---|---|---|
| **Web Serial** (`navigator.serial`) | the page | Chrome/Edge 89+, Firefox 151+, not Safari ([MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/Serial.json)) | Secure context only. `requestPort()` needs a user gesture. It covers "USB … devices that expose a virtual serial port to the OS" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)), which is the FTDI VCP the DMX USB Pro uses. Options include `baudRate`, `dataBits`, `stopBits` 1 or 2, and `parity`. `setSignals({ break })` exists ([WICG spec IDL](https://github.com/WICG/serial/blob/main/index.bs): `SerialOptions`, `SerialOutputSignals`), so even Open DMX timing is *possible*, just jittery. Also available in dedicated workers. |
| **WebUSB** | the page | Chrome/Edge 61+, not Firefox or Safari ([BCD](https://github.com/mdn/browser-compat-data/blob/main/api/USB.json)) | For devices without an OS driver ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API)). FTDI dongles normally *have* a driver, so Web Serial is the right API. WebUSB would mean writing an FTDI driver in JS. Not recommended. |
| **Web Serial in Electron** | the page | the desktop app | Electron shows no picker. The app must handle the session's `select-serial-port` event, and may use `setDevicePermissionHandler` / `setPermissionCheckHandler` ([Electron: Device Access](https://www.electronjs.org/docs/latest/tutorial/devices)). That means a few lines in `desktop/main.ts:87-109`, next to the current permission handler. |
| **Node `serialport`** | local server / Electron main | dev, preview, desktop | Mature and maintained: v13.0.0, last push 2026-01 (`npm view serialport`, https://github.com/serialport/node-serialport). Native module, so electron-builder has to rebuild it per platform. |
| **Node `dgram`** (Art-Net/sACN) | local server / Electron main | dev, preview, desktop | No native module. Libraries: `dmx` 0.25.1 (Pro, Open DMX, DMXking, artnet drivers; pushed 2026-05; https://github.com/node-dmx/dmx), `dmxnet` 0.9.0 (Art-Net sender/receiver; pushed 2026-01; https://github.com/margau/dmxnet), `sacn` 4.6.2 (sender and receiver; last push 2024-11; https://github.com/k-yle/sACN), `e131` 1.1.3 (last push 2024-04; https://github.com/hhromic/e131-node), `artnet` 1.4.0 (last push 2019; https://github.com/hobbyquaker/artnet; check whether it broadcasts, which Art-Net 4 now forbids). The ArtDmx and E1.31 packets are small enough to write by hand (section 4) if a dependency isn't worth it. |

## 6. From a frame to fixture channels

### Fixture profiles

The Open Fixture Library's JSON format is the obvious profile source
(https://github.com/OpenLightingProject/open-fixture-library/blob/master/docs/fixture-format.md):

- A fixture lists `availableChannels`. Each channel has `capabilities` with a `dmxRange` and a typed meaning, for
  example `ColorIntensity`, `ShutterStrobe`, `Intensity`, `Pan`/`Tilt`, `Effect` and `Zoom`.
- `modes` select an ordered subset of those channels, so a fixture's footprint depends on its mode.
- `fineChannelAliases` combine channels into 16- or 24-bit values. Matrices with template channels describe
  multi-pixel fixtures such as LED bars.
- The schema has a `Laser` category
  (https://github.com/OpenLightingProject/open-fixture-library/blob/master/schemas/fixture.json).

A **patch** is then *fixture profile + mode + universe + start address*, plus a **binding** for each channel to a
value from the frame.

### Natural bindings in this codebase

All of these are already in the Live `ProgramState` each frame (`src/engine/renderer.ts:81-108`), with reactivity and
the show scene's Look applied (`src/engine/look.ts:36-66`):

| Fixture capability | Frame source | Remarks |
|---|---|---|
| RGB `ColorIntensity` | `laser(program.hue)` on the CPU (`src/scenes/header.ts:27`) | Same wheel the built-in scenes draw with, so fixtures match the projected lines. Optionally apply `grade.tint`/`saturation`. |
| Dimmer `Intensity` | `master` × (a floor + `level` or `beat`) | `master` is the studio fader and blackout (`src/app/studio.ts:460-466`), so DMX fades with Take and blackout. |
| `ShutterStrobe` | `beat` (kick pulse) or `tickPhase` / `ticks` | **Must be rate-limited** to the strobe rule (≤ 3 flashes/s, `docs/scenes.md:10-11`). The picture's check doesn't cover fixtures. |
| `Pan`/`Tilt`, `Effect` speed | `turn` (effects' turn, only runs on) and `time` (the music's clock) | Smooth, music-paced motion, without jumps on stalls (`dt` is capped, `src/app/controller.ts:909-910`). |
| Chase / step | `ticks` (whole ticks) and bars (`ticks / 4`) | Steps on the tempo and keeps going through breakdowns, as the Glossary's **Tick** describes. |
| Pixel-mapped bars | picture readback (`src/engine/renderer.ts:561-590`) | Possible later. Costs a GPU readback per frame. |

### Lasers: ILDA versus DMX

- **ILDA (ISP-DB25)** is an analog vector interface. The required signals are "X, Y, R, G, B, Shutter, Ground and
  Interlock loop", with X/Y as ±10 V differential deflection
  (https://www.ilda.com/resources/StandardsDocs/ILDA_ISP99_rev002.pdf). Driving it needs an ILDA DAC fed with **point
  paths**. Hallucinate draws **raster** fragment shaders (`src/engine/renderer.ts:55-72`, the scene modules under
  `src/scenes/`). Its scenes *look* like lasers but have no vector form, so an ILDA output would be a separate
  renderer. That is out of scope here.
- **DMX lasers** only offer preset-driven channels. In the OFL profile for Laserworld's CS-1000RGB (11-channel mode)
  the channels are Mode, Pattern, Circular Movement, X/Y Rotation, Horizontal/Vertical Movement, Zoom, Pattern
  Buildup, Dot Effect with Strobe and a Color preset
  (https://github.com/OpenLightingProject/open-fixture-library/blob/master/fixtures/laserworld/cs-1000rgb.json).
  Mapping means *picking patterns and colours on ticks and kicks*, not reproducing a scene's lines.
- **Legal and safety:** in the US, laser shows above Class IIIa need an FDA variance before use
  (https://www.fda.gov/radiation-emitting-products/home-business-and-entertainment-products/laser-light-shows). This
  is the operator's responsibility, but the app should never be what turns a laser's shutter on without a deliberate
  arm switch.

---

## 7. Recommendation

### Where a DMX feed plugs in

- **One pure function, `src/engine/dmx.ts` (new):** `composeUniverse(program: ProgramState, patch, out: Uint8Array)`.
  It works like `composeFrame` (`src/engine/look.ts:36`): no allocation, unit-testable with vitest like `look.test.ts`.
  It owns the strobe rate limit and the laser-palette port.
- **Call it once a frame in `Controller.step`,** right after `route()` (`src/app/controller.ts:938-941`), with the
  frame the audience sees. `route()` today only composes Live when a projector is connected or the screen shows Live
  (`src/app/live-slot.ts:108-112`). A DMX feed counts as an audience output too, so pass
  `this.output.connected || dmx.connected` as `projector`. Otherwise fixtures would follow the main screen while Live
  is pinned.
- **A sender with its own clock:** it keeps the newest universe and sends at ≤ 40–44 Hz (ENTTEC Pro max 40,
  Art-Net gateways max 44, E1.11 44). It re-sends at least once a second when nothing changes (sACN source loss is
  2.5 s). It belongs with `OutputLink` (`src/engine/output-link.ts`) as a sibling, and appears in the UI's `outputs`
  status (`src/app/controller.ts:192`).
- **A glossary term:** the glossary has no word yet for "the fixtures" or "the patch". Add one with the
  domain-modeling skill before naming things, and an ADR for the strobe/shutter rule on fixtures, in line with ADR
  0002 and ADR 0003.

### Option A: Art-Net / sACN through the local server (recommended for a real rig)

- The page sends the universe (≤ 512 bytes, ≤ 44/s) to a new `/api/dmx` route registered in `server/routes.ts:23-36`.
  The same route then works in `npm run dev`, `vite preview` (`vite.config.ts:9-14`) and the desktop app
  (`desktop/server.ts:57`). The route sends ArtDmx (unicast, port 6454) or sACN (multicast 239.255.x.y, port 5568)
  with `dgram`, written by hand or with `dmxnet`/`sacn`.
- **Pros:** no native module and no driver. Many universes. Isolation and distance come from the network. Works with
  any Art-Net/sACN node or with fixtures that take Art-Net/sACN directly. Can merge with a lighting desk (sACN
  priority).
- **Cons:** needs an Ethernet DMX node (more expensive than a USB dongle). Not in the GitHub Pages demo
  (`src/app/static-demo.ts:2`). Adds a page-to-server hop of about one frame of latency. The server has to send its
  own keep-alive frames.

### Option B: ENTTEC DMX USB Pro (or a Pro-compatible DMXking) through Web Serial, in the page

- Open the port with `navigator.serial` and send one label-6 packet whenever the universe changes. The widget
  refreshes the line by itself at up to 40 fps (section 3). About 30 lines of framing code and no dependency.
- **Pros:** works in the browser, the web demo and Electron alike. Lowest latency, no server hop. The device handles
  DMX timing, so the 60 fps WebGL loop's jitter doesn't matter.
- **Cons:** one universe per widget. Chromium-based browsers or Firefox 151+, no Safari. A user gesture is needed to
  pick the port. Electron needs a `select-serial-port` handler and a serial permission in `desktop/main.ts:87-109`.

### Option C, not recommended: Open DMX USB / FTDI clones

- Cheapest hardware, but the host has to generate BREAK/MAB and the 22.7 ms frames itself. In JS that means timer-
  driven `setSignals({ break })` / `brk` toggling, which even the `dmx` library calls unstable. If you already own one,
  run it from Node (`dmx` library's `enttec-open-usb-dmx` driver behind the Option A route), not from the page.

**Suggested order:** build `composeUniverse` + patch + strobe limit first, since every option needs them. Then ship
**B** (smallest, works everywhere Chromium runs). Add **A** when the rig needs more than one universe or a network.

---

## Open questions

1. **What DMX hardware is on hand?** A DMX USB Pro or Pro-compatible device points to B, an Open DMX/FTDI clone to C
   via Node, and an Art-Net/sACN node or network-capable fixtures to A.
2. **Which fixtures?** Are they LED washes/pars (RGB, dimmer, strobe), moving heads (pan/tilt), DMX lasers (pattern
   presets), or LED bars (pixel mapping, which needs picture readback)? The answer decides whether OFL profiles are
   worth importing or whether a few hand-written profiles are enough.
3. **Should fixtures follow Live only, or also the main screen when nothing is pinned?** The proposal mirrors the
   projectors.
4. **Is the strobe rule (≤ 3 flashes/s) also the rule for fixture strobe/shutter channels?** And should lasers need
   an explicit arm switch?
5. **Does the web demo need DMX?** If yes, B is the only path, because A needs the server.
6. **E1.11-2024 and E1.31-2025 are the current editions.** The timing numbers here come from E1.11-2008 (R2018), and
   the sACN numbers from ETC's reference library. Download the current PDFs from ESTA before relying on edge values.
