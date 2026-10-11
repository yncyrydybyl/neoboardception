# NeoBoardception – Spike A: verschachtelte Capability-Vermittlung

Wegwerf-Spike (kein Produktionscode). Er beweist, ob ein Widget, das _in_
NeoBoard läuft, über NeoBoard hinweg Capabilities beim obersten Client (Element
Web) bekommt – auch zur Laufzeit (MSC2974).

```
Element Web ──(NeoBoards WidgetApi, NeoBoards widgetId)──▶ NeoBoard-Fork
NeoBoard    ──(ClientWidgetApi + ForwardingDriver)───────▶ inneres Testwidget
```

## Inhalt

| Pfad                            | Zweck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nested-host/src/nestedHost.ts` | Vermittler (Host-Seite für das innere Widget). `ForwardingDriver.validateCapabilities` fordert fehlende Caps per MSC2974 als **Vereinigung** (NeoBoard + inneres Widget) unter NeoBoards Identität bei Element an, wartet auf `notify_capabilities` und gibt die Schnittmenge zurück. `sendEvent`/`readRoomTimeline`/`readRoomState` gehen nach oben; `send_event`/`update_state`/`theme_change` von Element gehen gefiltert (durch `ClientWidgetApi.feedEvent`) nach unten. Enthält einen `event.source`-Guard und einen Namespace-Guard (NeoBoards eigene Caps werden nie an das innere Widget durchgereicht). |
| `nested-host/src/mountSpike.ts` | Overlay-Panel (fest unten rechts) im Board; nur im Spike-Build enthalten (`VITE_NBC_SPIKE_INNER_ORIGINS` = Allow-List erlaubter Origins) und nur aktiv, wenn die NeoBoard-URL `nbc_inner=<https-URL>` trägt und deren Origin auf der Allow-List steht. Ohne die Variable ist der Spike-Code nicht im Bundle.                                                                                                                                                                                                                                                                                                     |
| `test-widget/`                  | Messinstrument: reines `matrix-widget-api`. Startanfrage: `send`+`receive` von `net.neoboardception.ping`. Button **Nachfordern**: MSC2974-Anfrage für State-Event `net.neoboardception.pong` (`state_key ""`) und Senden. Protokolliert jede Widget-API-Nachricht sichtbar.                                                                                                                                                                                                                                                                                                                                     |
| `scripts/build.sh`              | Reproduzierbarer Build (NeoBoard-Workspace + Testwidget).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `scripts/serve.mjs`             | HTTPS-Static-Server (NeoBoard `:5443`, inneres Widget `:5444`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `scripts/e2e-element.mjs`       | Messlauf in echtem Element Web über CDP (Playwright `connectOverCDP`), inkl. Video mit Untertiteln. Alle Infrastruktur-Angaben kommen aus Umgebungsvariablen.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Geänderte Kerndateien des Forks

| Datei                                  | Änderung                                                                |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `matrix-neoboard-widget/src/index.tsx` | 1 Import + 3 Zeilen: `maybeMountNeoBoardceptionSpike(widgetApiPromise)` |
| `matrix-neoboard-widget/tsconfig.json` | `rootDir: ".."` und `include` um `../spike/nested-host/src` erweitert   |

Sonst nichts im NeoBoard-Kern.

## Bauen und lokal ausliefern

```sh
spike/scripts/build.sh                       # yarn install --frozen-lockfile; REACT_APP_RTC=webrtc yarn build; esbuild
TLS_CERT=… TLS_KEY=… node spike/scripts/serve.mjs   # ohne TLS_* wird ein Wegwerf-Zertifikat erzeugt
```

Widget-URL für `im.vector.modular.widgets` (`waitForIframeLoad: true`!):

```
https://<neoboard-host>/?widgetId=$matrix_widget_id&nbc_inner=<urlencoded https-URL des inneren Widgets>#/?theme=$org.matrix.msc2873.client_theme&matrix_user_id=$matrix_user_id&matrix_room_id=$matrix_room_id&…
```

## Messlauf

```sh
export ELEMENT_URL=https://app.element.io           # Element-Instanz mit MAS-Passwort-Login
export MATRIX_HOMESERVER=https://matrix.example.org
export CREDS_FILE=/path/to/creds.json               # {users:{bot:{user_id,localpart,password,access_token},peer:{user_id,access_token}},rooms:{"!room:example.org":{}}}
export PLAYWRIGHT_DIR=/path/with/node_modules/playwright
node spike/scripts/e2e-element.mjs                  # HEADED=1 zum Zuschauen, VIDEO_MP4=… für das Video
```

Das Skript installiert das Widget per CS-API (Layout `center`), meldet sich über
MAS an, bestätigt die Element-Dialoge selbst, misst M1–M3, das
„Merken“-Verhalten nach einem Reload und schreibt
`results.json`, Screenshots und Logs nach `SHOTS_DIR`.

## Ergebnis in Kurzform

- **M1** Startanfrage des inneren Widgets → Element zeigt einen Dialog (als
  Nachforderung _NeoBoards_). **M2** Laufzeit-Nachforderung über zwei Ebenen → zweiter
  Dialog. **M3** Events landen im Raum und werden wieder nach unten zugestellt.
- Element-Dialoge nennen das innere Widget nicht; die Identität ist immer NeoBoard.
- Element überschreibt bei „Merken“ die gemerkten Caps mit nur den _neu_ angefragten –
  nach einem Reload fragt Element NeoBoards eigene Caps erneut ab.
