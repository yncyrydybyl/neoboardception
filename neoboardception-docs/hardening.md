# NeoBoardception: Härtung und Widget-Lifecycle-Konfiguration

Status: Leitfaden; Ebene 2 (Abschnitt 9) ist umgesetzt. Die Verifikation
(Abschnitt 11) in einem echten Element steht aus.

Dieses Dokument beschreibt, wie NeoBoardception (NeoBoard mit eingebetteten
Matrix-Widgets, erster Fall: Matrix Poll) vom PoC mit Klick-Dialogen in einen
deklarativ konfigurierten, auditierbaren Betrieb überführt wird. Die
Beispielkonfigurationen liegen in [`examples/`](examples/) und werden aus dem
Quellcode erzeugt (Abschnitt 10).

Platzhalter in diesem Dokument und in den Beispielen:

| Platzhalter                    | Bedeutung                                            |
| ------------------------------ | ---------------------------------------------------- |
| `https://neoboard.example.org` | Origin, von dem der Betreiber NeoBoard ausliefert    |
| `https://poll.example.org`     | Origin, von dem der Betreiber Matrix Poll ausliefert |
| `https://element.example.org`  | Selbst betriebenes Element Web                       |

## 0. Kernbefunde

1. **Vorab-Genehmigung greift auch bei MSC2974-Nachforderungen.** Element ruft
   für die erste Anfrage und für jede spätere Nachforderung dieselbe Funktion
   `ElementWidgetDriver.validateCapabilities` auf. Dort wird der
   Capabilities-Approver des Moduls gefragt (Belege in Abschnitt 6).
2. **Das aktuelle Modul vergleicht die rohe Widget-URL, inklusive Query und
   Hash.** Das ältere Nordeck-Modul hat Query und Hash vorher entfernt. Eine
   exakte Regel `https://neoboard.example.org/` greift im aktuellen Modul bei
   einer üblichen NeoBoard-URL (`https://neoboard.example.org/#/?theme=…`)
   **nie**. Die Dialoge erscheinen dann weiter, ohne Fehlermeldung. Nötig ist
   `https://neoboard.example.org/*` (Abschnitt 5).
3. **Der Konfigurationsschlüssel hat sich geändert.** Aktuell (Element-Modul,
   Module API v2): `io.element.element-web-modules.widget-lifecycle`. Der
   Schlüssel `net.nordeck.element_web.module.widget_lifecycle` gilt nur für das
   alte Nordeck-Modul (Legacy-Module-API, `build_config.yaml`).
4. **`build_config.yaml` gibt es in aktuellem Element Web nicht mehr.** Das
   Legacy-Modulsystem wurde im September 2026 entfernt (element-web PR #33941).
   Aktuell gibt es nur das Laden zur Laufzeit über `config.json` → `modules`.
   Das Docker-Image kann die Module mitbringen (Abschnitt 3).
5. **Das Modul verweigert nichts.** Nicht gelistete Capabilities werden nicht
   abgelehnt. Element zeigt für sie den normalen Dialog. Harte Ablehnung leistet
   nur NeoBoard (Allow-Lists im Vermittler).
6. **Pre-Approval behebt den "Remember my selection"-Fehler.** Ist alles
   vorab genehmigt, zeigt Element keinen Dialog, und die gemerkte Liste wird
   nicht überschrieben.

## 1. Zweistufiger Pfad

| Stufe       | Element                                        | Zustimmung                                                                                         | Zweck                                      |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1: PoC      | beliebiges Element (z. B. app.element.io)      | Element-Dialog für NeoBoard, bei Bedarf Nachforderungsdialog für eingebettete Widgets              | Machbarkeit zeigen; Testserver, Testkonten |
| 2: gehärtet | selbst betriebenes Element mit Lifecycle-Modul | keine Element-Dialoge für NeoBoard und die Poll-Modals; NeoBoard entscheidet nach Betreiber-Policy | Betrieb, z. B. im öffentlichen Sektor      |

In Stufe 1 bleibt die bekannte Schwäche aus dem Spike bestehen: Der Dialog
nennt NeoBoard, nicht das eingebettete Widget. Bei Nachforderungen überschreibt
"Remember my selection" die gemerkte Liste mit den zuletzt angefragten
Capabilities. Nach einem Reload fragt Element NeoBoards eigene Capabilities
deshalb erneut. Stufe 2 löst beides über die Konfiguration. Der Code bleibt
gleich.

## 2. Bedrohungsmodell (Kurzfassung)

Element sieht nur NeoBoard. Alles, was unter NeoBoards URL vorab genehmigt ist,
gilt für **jeden Code, der in NeoBoard läuft**. Dazu gehören eingebettete
Widgets. Eingebettete Widgets müssen daher vom Betreiber vertraut sein.
Behandle ein eingebettetes Widget mit demselben Vertrauen wie NeoBoard selbst.
Das Lifecycle-Modul kann nicht erkennen,
welches Widget NeoBoard einbettet. Daraus folgen diese Pflichtbedingungen. Sie
gelten **zusammen**:

| Maßnahme                                           | Umsetzung                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Origin-Allow-List aus der Deployment-Konfiguration | NeoBoards Policy (`REACT_APP_EMBEDDED_WIDGET_POLICY`, Abschnitt 9) oder `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`. Gilt für Einfügen und Mounten im Board-Element und als `allowedOrigins` im Vermittler. Nie aus Raum-State, Widget-Parametern oder Board-Inhalt.                             |
| Passende Modulregeln                               | Die Poll-Capabilities stehen in NeoBoards Regel **nur**, wenn NeoBoard die Allow-List erzwingt. Modal-Regeln nennen nur die Poll-Origin und exakte Pfade.                                                                                                                                        |
| CSP `frame-src` auf NeoBoards Host                 | Das widget-server-Image setzt `frame-src 'self' $CSP_FRAME_SRC`. `CSP_FRAME_SRC` muss genau die Allow-List enthalten. Ohne diese Variable blockiert der Browser jedes eingebettete Widget. Mit `*` oder `https:` wäre die Liste wirkungslos.                                                     |
| Widget-Bearbeitung nur durch Admins                | Power Level für `im.vector.modular.widgets` (und `io.element.widgets.layout`) auf Admin setzen. Sonst kann jeder mit diesem Recht ein Widget mit NeoBoards URL anlegen, und es ist vorab genehmigt. Räume, die mit nicht vertrauenswürdigen Servern föderieren, sollten Einbettung nicht nutzen. |
| Eigene NeoBoard-Origin                             | Die Regel `https://neoboard.example.org/*` gilt für jeden Pfad dieser Origin. Dort darf nur NeoBoard liegen, kein anderer Inhalt und keine Nutzer-Uploads.                                                                                                                                       |
| Versionsgepinnte, selbst gehostete innere Widgets  | Poll läuft auf einer Betreiber-Origin, Version gepinnt (Image-Digest), Lieferkette kontrolliert, keine Fremd-Skripte oder Sub-Frames. Ein eingebettetes Widget hat dasselbe Vertrauen wie NeoBoard selbst.                                                                                       |
| Kein `identity_approved` im Modul                  | Kein OpenID ohne Nachfrage, weder für NeoBoard noch für Modals (Abschnitt 7). In NeoBoards Policy nur für ein inneres Widget, das OpenID wirklich braucht (Default aus, Abschnitt 9).                                                                                                            |
| Exakte Strings                                     | Keine Globs in Capability-Listen. Einzige Ausnahme ist der Sitzungs-Key pro Nutzer im WebRTC-Modus (Abschnitt 5.3).                                                                                                                                                                              |
| Hardened Build ohne Spike                          | `REACT_APP_NBC_SPIKE_INNER_ORIGINS` beim Build **nicht** setzen.                                                                                                                                                                                                                                 |

Zusatz: Element merkt sich Grants pro **Widget-ID**, nicht pro URL
(`localStorage` `widget_<id>_approved_caps`, `ElementWidgetDriver.ts:67-73`).
Ändert jemand die URL eines bestehenden Widgets, bleiben die gemerkten Grants
erhalten. Das ist ein weiterer Grund, die Widget-Bearbeitung auf Admins zu
beschränken.

## 3. Welches Modul, welcher Lademechanismus

| Variante                                | Element Web                                                                      | Paket / Quelle                                                                                        | Config-Schlüssel                                  | URL-Matching                            |
| --------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------- |
| **A: Laufzeit (empfohlen)**             | aktuell (Module API v2, `moduleApiVersion "^1.10.0 \|\| ^2.0.0"`)                | `modules/widget-lifecycle` im element-web-Monorepo, Release-Artefakt `module/widget-lifecycle/v1.1.0` | `io.element.element-web-modules.widget-lifecycle` | rohe `templateUrl` inkl. Query und Hash |
| **A': Laufzeit, im Image mitgeliefert** | aktuelles Docker-Image, Target `element_web_modules`                             | wie A, nach `/modules/<name>/` entpackt                                                               | wie A                                             | wie A                                   |
| **B: Build-Zeit (Legacy)**              | nur Releases **vor** der Entfernung des Legacy-Modulsystems (PR #33941, 09/2026) | `@nordeck/element-web-widget-lifecycle-module` über `build_config.yaml`                               | `net.nordeck.element_web.module.widget_lifecycle` | URL **ohne** Query und Hash             |

- **A:** In `config.json` steht unter `modules` die URL des Modul-Bundles. Element
  lädt es beim Start per `import()` (`apps/web/src/vector/init.tsx:169-178`).
  Beispiel: [`examples/config.runtime.json`](examples/config.runtime.json). Die
  Bundle-URL muss vom Element-Origin erreichbar sein, und Elements CSP muss sie
  erlauben. Am einfachsten liegt sie auf demselben Origin.
- **A':** Das Docker-Image lädt Module als Release-Archive mit Version und
  sha256-Prüfsumme (`apps/web/Dockerfile`, Stage `modules`). Beim Start trägt
  `docker-entrypoint.d/18-load-element-modules.sh` jedes Verzeichnis unter
  `/modules` automatisch in `config.json` → `modules` ein. **In diesem Fall
  `modules` nicht zusätzlich in die eigene config.json schreiben.** Ein doppelt
  geladenes Modul registriert seinen Approver zweimal. `WidgetLifecycleApi`
  wirft dann `approver already registered` (`apps/web/src/modules/WidgetLifecycleApi.ts:44-75`).
  Den Abschnitt `io.element.element-web-modules.widget-lifecycle` braucht es
  trotzdem.
- **B:** [`examples/build_config.yaml`](examples/build_config.yaml) plus
  [`examples/config.legacy-build.json`](examples/config.legacy-build.json). Hier
  matchen exakte URLs ohne `*`. Den Hash entfernt das alte Modul selbst
  (`cleanupUrl`).

Der Inhalt der Regeln ist in allen Varianten gleich. Nur der Schlüssel und die
URL-Muster unterscheiden sich. Beide Varianten erzeugt der Generator.

## 4. Regeln

### 4.1 NeoBoards Regel: Vereinigung

Element kennt nur NeoBoard. Die Capabilities eingebetteter Widgets fordert
NeoBoard **unter seiner eigenen Widget-ID** an. Der Vermittler nutzt dazu eine
MSC2974-Nachforderung mit der Vereinigung (siehe `packages/widget-mediation`).
Deshalb gilt:

```
capabilities_approved(NeoBoard-URL) = NeoBoard-eigene Capabilities ∪ POLL_CAPABILITIES
```

| Teil                                          | Quelle                                                                                                                                                | Anzahl (Stand dieses Branches) |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| NeoBoard, `REACT_APP_RTC=matrixrtc` (Default) | `matrix-neoboard-widget/src/widgetCapabilities.ts` (Basis plus MatrixRTC-Zweig) plus `io.element.requires_client`, das das Toolkit implizit anfordert | 28                             |
| NeoBoard, `REACT_APP_RTC=webrtc`              | Basis plus WebRTC-Zweig plus `io.element.requires_client`                                                                                             | 21                             |
| Poll                                          | `POLL_CAPABILITIES` in `packages/widget-mediation/src/capabilities.ts` (= Agent B, §7.1)                                                              | 15                             |
| davon neu gegenüber NeoBoard ("Poll-Delta")   | 10 × `net.nordeck.poll*` exakt plus `…receive.state_event:m.room.power_levels` ohne `#`                                                               | 11                             |
| Regel NeoBoard (matrixrtc)                    | Vereinigung                                                                                                                                           | 39                             |

`m.room.power_levels` steht zweimal in der Liste, und das ist Absicht.
NeoBoard fordert `…:m.room.power_levels#` an (State-Key `""`), Poll fordert
`…:m.room.power_levels` an (jeder Key). Element genehmigt nur exakt angefragte
Strings, deshalb müssen beide Strings in der Liste stehen.

Die Regel setzt `preload_approved: true`. Dann fehlt der Hinweis "Widget wurde
von X hinzugefügt" für Raum-Widgets anderer Nutzer. Das ist vertretbar, wenn nur
Admins Widgets anlegen dürfen (Abschnitt 2). Wer den Hinweis sehen will, setzt
`false`.

**Entscheidung für Betreiber: `send.state_event:m.room.power_levels#`.** Diese
Capability gehört zu NeoBoard selbst. NeoBoard passt beim Anlegen eines Boards
die Power Levels an (`patchPowerLevels`). Faktisch heißt sie "darf die Power
Levels des Raums schreiben", soweit der Homeserver es dem Nutzer erlaubt. Mit
Pre-Approval darf das ohne Nachfrage jeder Code in NeoBoard, auch ein
eingebettetes Widget (siehe Abschnitt 2). Mit
`--omit org.matrix.msc2762.send.state_event:m.room.power_levels#` lässt der
Generator sie weg. Dann fragt Element genau diese eine Capability per Dialog ab.
Default der Beispiele: enthalten, damit wirklich kein Dialog erscheint.

### 4.2 Modal-Regeln für Poll

Poll öffnet zum Anlegen und Bearbeiten von Polls und Gruppen ein Element-Modal
(`open_modal`). Element lädt die Modal-URL **top-level**. Das iframe ist nicht in
NeoBoard verschachtelt, läuft unter `modal_<NeoBoard-Widget-ID>` und fordert
wieder alle 15 Poll-Capabilities an. Der Modal-Driver ist ebenfalls ein
`ElementWidgetDriver` (`ModalWidgetDialog.tsx:76`), deshalb greift das Modul
auch hier. Das Toolkit baut die URL so: Pfad ersetzt, Query geleert, Parameter im
Hash (`generateWidgetRegistrationUrl`), also

```
https://poll.example.org/create-poll#/?theme=…&matrix_user_id=…
https://poll.example.org/admin/create-group#/?theme=…
```

Die Regeln lauten deshalb (Variante A):

```
https://poll.example.org/create-poll#*          → POLL_CAPABILITIES
https://poll.example.org/admin/create-group#*   → POLL_CAPABILITIES
```

Variante B: `https://poll.example.org/create-poll` und
`https://poll.example.org/admin/create-group`, jeweils exakt.

- Kein `https://poll.example.org/*`. Diese Regel würde auch einem direkt im Raum
  eingebundenen Poll jede künftige Route freigeben.
- Kein `preload_approved` und kein `identity_approved` (bei Modals ohne Wirkung
  bzw. nicht gewollt).
- Die Modal-Regeln braucht es nur, wenn der Vermittler `open_modal` weitergibt
  (`modals: 'forward'`). Default des Pakets ist `'deny'`. Dann kann Poll aber
  keine Polls anlegen. Die Alternative ist, Modals in NeoBoard zu rendern. Das
  ist noch nicht umgesetzt. Mit `--no-modals` lässt der Generator die Regeln weg.
- Element erlaubt nur ein Modal zur Zeit. Das Ergebnis (`close_modal`) geht an
  NeoBoard, der Vermittler reicht es an das öffnende Widget weiter.

## 5. Fallstricke

### 5.1 URL-Matching (Modul v2)

- Das Modul vergleicht `widget.templateUrl`, also die **rohe, nicht ersetzte**
  URL aus dem Widget-State-Event (`WidgetLifecycleApi.ts:22-31`), mit
  `matchPattern` (`modules/widget-lifecycle/src/utils/matchPattern.ts:13`): Ein
  `*` am Ende bedeutet Präfix, alles andere muss exakt gleich sein. Query und
  Hash werden **nicht** entfernt.
- Immer bis einschließlich `/` hinter dem Host schreiben:
  `https://neoboard.example.org*` würde auch auf
  `https://neoboard.example.org.attacker.example/` passen.
- Ein `*` gibt es nur als Suffix. `https://*.example.org/` ist ein wörtlicher
  String und passt nie.

### 5.2 Merge-Regel und Sortierung

- Passen mehrere Muster, merged das Modul **feldweise**. Später sortierte Regeln
  überschreiben frühere (`constructWidgetPermissions.ts:20-22`).
  `capabilities_approved` wird dabei **nicht** vereinigt: Die gewinnende Regel
  ersetzt die Liste vollständig.
- "Spezifischer" heißt im Code **alphabetisch später**
  (`localeCompare`, `constructWidgetPermissions.ts:27`), nicht "länger". Beispiele:
  - `https://neoboard.example.org/` (exakt) und `https://neoboard.example.org/*`
    treffen beide auf die URL `https://neoboard.example.org/`. `/*` sortiert
    später und **gewinnt gegen die exakte Regel**.
  - `https://poll.example.org/create-poll#*` sortiert nach
    `https://poll.example.org/*` und gewinnt. Gäbe es zusätzlich eine breite
    Poll-Regel, hätte das Modal also die Modal-Liste, nicht die Vereinigung.
- Folge: Eine allgemeine Regel, die alle Widgets einer Origin abdeckt, und eine
  speziellere mit kürzerer Liste ergeben **keine** Summe. Jede Regel muss für
  sich vollständig sein. Der Generator schreibt deshalb vollständige Listen pro
  Regel.

### 5.3 Wildcards in Capability-Strings

Zwei Semantiken überlagern sich, und genau das macht Wildcards fehleranfällig:

| Schreibweise       | matrix-widget-api / Element                 | Lifecycle-Modul (`matchPattern`)                           |
| ------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| `…state_event:T`   | State-Event Typ T, **jeder** State-Key      | exakt dieser String                                        |
| `…state_event:T#`  | nur State-Key `""`                          | exakt dieser String                                        |
| `…state_event:T#*` | **wörtlicher** State-Key `*`, kein Wildcard | Präfix `…:T#`, passt auf jeden **angefragten** `T#<key>`   |
| `…state_event:T*`  | (kein gültiger Typ)                         | Präfix: passt auf `T`, `T.group`, `T.settings`, `Tfoo#x` … |

- Das Modul genehmigt nur, was das Widget **anfragt**, gefiltert durch die
  Muster (`WidgetLifecycleModule.ts:77-89`). `T#*` genehmigt deshalb **nicht**
  das schlüssellose `T`, das Poll anfragt. `T*` genehmigt es, aber auch jeden
  künftigen Typ mit diesem Präfix. **Deshalb nur exakte Strings.**
- Einzige nötige Ausnahme: Im WebRTC-Modus fordert NeoBoard
  `…send.state_event:net.nordeck.whiteboard.sessions#<eigene User-ID>` an. Eine
  statische Regel kann die User-ID nicht nennen, also steht dort
  `…sessions#*`. Das Risiko ist begrenzt: Angefragt wird immer nur die eigene
  ID, und Homeserver lassen State-Keys, die mit `@` beginnen, nur für den
  jeweiligen Nutzer zu. Im Default-Modus `matrixrtc` gibt es diese Ausnahme
  nicht.
- Der Vermittler hat eigene Glob-Regeln (`allowCapabilityGlobs`: nur `.*`/`#*`
  am Ende, nie für `send`). Sie gelten nur für die NeoBoard-interne Ebene und
  nicht für Element.

### 5.4 Konfigurationsfehler sind still

- Ein ungültiger Modulabschnitt (Schemafehler) führt zu `console.error` und
  einer leeren Konfiguration (`WidgetLifecycleModule.ts`, `load`). Die Dialoge
  erscheinen dann wieder.
- Ein falscher Schlüssel (z. B. der Nordeck-Schlüssel in Variante A) wird
  ignoriert, mit dem Log `No configuration found …`.
- Gilt eine Regel nicht, weil die URL nicht passt (Abschnitt 5.1), gibt es gar
  keinen Hinweis.
- Deshalb gehört der Test "kein Dialog" zur Abnahme (Abschnitt 11).

## 6. Nachforderung (MSC2974): greift die Vorab-Genehmigung?

**Ja.** Code-Pfad (element-web `develop` @ `171955a9e2`, 2026-10-09;
matrix-widget-api 1.19.0):

1. Erste Anfrage: `ClientWidgetApi.beginCapabilities` →
   `driver.validateCapabilities(requested)` (matrix-widget-api
   `src/ClientWidgetApi.ts:264-282`, Aufruf `:273`).
2. Nachforderung: from-widget `org.matrix.msc2974.request_capabilities` →
   `handleCapabilitiesRenegotiate` (`src/ClientWidgetApi.ts:1106-1107` →
   `:403-418`). Es geht nur `newlyRequested` (angefragt minus bereits erlaubt,
   `:407`) an **denselben** `driver.validateCapabilities` (`:414-417`). Das
   Ergebnis wird zu den bestehenden Grants **addiert** (`allowCapabilities`,
   `:284-287`).
3. `ElementWidgetDriver.validateCapabilities`
   (`apps/web/src/stores/widgets/ElementWidgetDriver.ts:247-295`) fragt bei
   jedem Aufruf zuerst `ModuleApi.instance.widgetLifecycle.preapproveCapabilities`
   (`:260-269`). Nur was danach noch fehlt (`missing`), kommt in den Dialog
   (`:273-284`). Die Legacy-Module-API (Variante B) hing vor ihrer Entfernung an
   derselben Stelle (`WidgetLifecycle.CapabilitiesRequest` in
   `validateCapabilities`).
4. Das Modul prüft jede neu angefragte Capability gegen die Regel der
   NeoBoard-URL (`WidgetLifecycleModule.ts:77-89`). Weil die Regel die
   Vereinigung enthält, wird die Poll-Delta bei der Nachforderung ohne Dialog
   genehmigt.

Folgen:

- **"Remember"-Fehler:** Element merkt sich nur, wenn ein Dialog mit "Remember"
  bestätigt wurde (`:290-292`), und speichert dann nur
  `allowedSoFar ∩ requested`, also bei einer Nachforderung nur die neuen
  Capabilities. Ohne Dialog wird nichts überschrieben. Bleibt aber auch nur
  **eine** Capability ungelistet, erscheint der Dialog wieder, und der Fehler
  tritt erneut auf. Deshalb vollständige Listen.
- Kleiner Fehler in matrix-widget-api: Ist `newlyRequested` leer, ruft
  `handleCapabilitiesRenegotiate` `allowCapabilities([], [])` auf und danach
  trotzdem `validateCapabilities(∅)` (`:409-417`, fehlendes `return`). Element
  sendet dann zwei `notify_capabilities` mit `requested: []`. `approved` enthält
  in beiden die **gesamte** bisherige Menge (matrix-widget-api `:291-295`). Einen Dialog gibt es
  nicht. Für den Vermittler (`handleNotify` ersetzt die Menge durch `approved`)
  ist das unkritisch.

## 7. Was für Nutzer sichtbar bleibt

| Situation                                                                         | Sichtbar                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NeoBoard im MatrixRTC-Modus (Default)                                             | **OpenID-Dialog** von Element, denn NeoBoard holt ein OpenID-Token für LiveKit (`requestOpenIDConnectToken`). Gewollt, weil `identity_approved` nicht gesetzt ist. Element merkt sich die Entscheidung pro Widget. Im WebRTC-Modus gibt es den Dialog nicht. |
| Capability, die nicht in der Regel steht (z. B. neue NeoBoard- oder Poll-Version) | Element-Dialog nur für diese Capabilities. **Keine** stille Ablehnung.                                                                                                                                                                                       |
| Eingebettetes Widget von nicht gelisteter Origin                                  | Kein Element-Dialog. NeoBoard zeigt nur den Platzhalter (Board-Element) bzw. `load-failed` (Vermittler).                                                                                                                                                     |
| Inneres Widget fragt eine Capability außerhalb der Vermittler-Allow-List an       | Kein Element-Dialog: Der Vermittler blockiert sie (`blockedByPolicy`).                                                                                                                                                                                       |
| Lokale Zustimmung in NeoBoard                                                     | Nach Ebene-2-Policy (Abschnitt 9): bei `preload_approved` kein Panel, nur ein Hinweis in der Statusleiste ("Von deiner Administration freigegeben", mit Name und Origin); sonst NeoBoards Panel, das das innere Widget benennt.                              |
| "Load widget"                                                                     | Platzhalter, bis ein Nutzer das Widget aktiviert. Bleibt auch mit `preload_approved` eine Nutzeraktion (Abschnitt 9.1).                                                                                                                                      |
| Poll-Modal                                                                        | Das Modal selbst. Element zeigt Name und Buttons; ohne Modal-Regel zusätzlich einen Capability-Dialog.                                                                                                                                                       |

## 8. NeoBoard-Einstellungen

[`examples/neoboard.env.example`](examples/neoboard.env.example):

- `REACT_APP_EMBEDDED_WIDGET_POLICY`: NeoBoards Policy (Abschnitt 9), als
  `base64:<JSON>`. Der Generator erzeugt den Wert.
- `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS`: exakte Origins, kommagetrennt.
  Ohne Policy die Allow-List (leer heißt, die Einbettung ist aus), mit Policy
  eine Obergrenze. Alle Variablen werden zur Laufzeit über das
  widget-server-Image eingespielt (`window.__ENVIRONMENT__`); beim Build
  gesetzte Werte (`import.meta.env`) gelten als Fallback.
- `REACT_APP_EMBEDDED_WIDGET_MODAL_ORIGINS`: Origins, deren Widgets Modals
  öffnen dürfen (nötig zum Anlegen von Polls).
- `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION`: optional `true` (Abschnitt 9.3).
- `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES`: optional, exakte
  Capabilities zusätzlich zur Poll-Allow-List. Ohne Policy bekommt jedes
  erlaubte Widget sie; mit Policy ist die Liste eine Obergrenze (Abschnitt
  9). Globs und Einträge der harten Deny-List werden mit Warnung ignoriert.
- `REACT_APP_EMBEDDED_WIDGET_MAX_LIVE`: optional, gleichzeitig laufende
  eingebettete Widgets pro Client (1–20, Default 3), unabhängig von der
  Policy.
- `CSP_FRAME_SRC`: dieselben Origins, leerzeichengetrennt. Variable des
  widget-server-Images.
- `REACT_APP_RTC`: muss zum Generatorlauf passen (`--rtc`), sonst fordert
  NeoBoard Capabilities an, die nicht in der Regel stehen.
- Build: `REACT_APP_NBC_SPIKE_INNER_ORIGINS` nicht setzen.
- Der Renderer (`matrix-neoboard-widget/src/embeddedWidgets/mediationRenderer.ts`)
  übergibt dieselbe Allow-List als `allowedOrigins` an den Vermittler.
- Optional, Härtung von Poll: Auf der Poll-Origin
  `frame-ancestors https://element.example.org https://neoboard.example.org`
  setzen. Dazu die CSP-Datei des widget-server-Images ersetzen, eine
  Env-Variable dafür gibt es nicht.

## 9. Zwei Ebenen: Element-Lifecycle-Modul (Element↔NeoBoard) und NeoBoard-eigene Lifecycle-Policy (NeoBoard↔eingebettete Widgets)

```
Element ──(Ebene 1: Lifecycle-Modul, Regel für NeoBoard-URL)── NeoBoard
NeoBoard ──(Ebene 2: NeoBoard-Policy, Regel pro inneres Widget)── Poll, …
```

### 9.1 Ebene 2: NeoBoards Policy (umgesetzt)

Der Betreiber gibt NeoBoard eine Policy im **Schema des Moduls**, damit Admins
nur ein Format lernen. Sie liegt nie im Raum-State und nie im Board-Inhalt.

```json
{
  "version": 1,
  "unlisted": "deny",
  "widget_permissions": {
    "https://poll.example.org/": {
      "name": "Poll",
      "preload_approved": false,
      "identity_approved": false,
      "capabilities_approved": ["…15 exakte Poll-Strings…"]
    }
  }
}
```

Beispiel: [`examples/embedded-widgets.policy.json`](examples/embedded-widgets.policy.json).
`name`, `unlisted` und `version` sind Erweiterungen. Das Modulschema ist
`looseObject` und toleriert sie.

**Quelle: `REACT_APP_EMBEDDED_WIDGET_POLICY`**, gelesen wie jede andere
Einstellung: zur Laufzeit aus `window.__ENVIRONMENT__`, als Fallback aus
`import.meta.env` (Build). Wert: JSON oder `base64:<JSON>`. Entschieden gegen
eine nachgeladene Datei, weil

- die Initial-Union (9.3) die Liste **synchron** braucht, bevor
  `WidgetApiImpl.create` läuft; ein `fetch` käme zu spät;
- eine fehlende Datei hinter `try_files … /index.html` als HTML mit Status 200
  ankäme und es keinen Zwischenzustand "Policy lädt noch" gibt;
- es nur einen Mechanismus für Laufzeit und Build gibt.

JSON direkt in der Env-Variable ist im Container **nicht** robust:
`provide_environment.sh` setzt `"$n":"$v"` ohne Escaping zusammen, ein `"`
im Wert zerstört das ganze Environment. Deshalb `base64:`. Der Generator
schreibt den Wert aus derselben Policy in `neoboard.env.example`.

**Code:** Die Engine ist ein kleines, reines Modul im Vermittlerpaket
(`packages/widget-mediation/src/policy.ts`, eigener Einstiegspunkt
`@nordeck/matrix-widget-mediation/policy`). Es kennt NeoBoard nicht. Der
eigene Einstiegspunkt hält den Rest des Pakets aus dem Haupt-Bundle; der
Vermittler bleibt ein Lazy-Chunk. Die Verdrahtung liegt in
`matrix-neoboard-widget/src/embeddedWidgets/config.ts`.

| Policy-Feld                         | Wirkung in NeoBoard                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schlüssel (URL, `*` nur als Suffix) | Matching gegen Origin + Pfad der Widget-URL im Board, **ohne Query und Hash**, nach URL-Normalisierung. Die Origins aller Schlüssel ergeben die Origin-Allow-List (`isUrlAllowed`, `allowedOrigins`).                                                                  |
| `capabilities_approved`             | `allowedCapabilities` beim Mount, abzüglich Hard-Deny-Liste des Vermittlers und NeoBoards eigener Typen (`net.nordeck.whiteboard*`). Nicht gelistete Capabilities: `blockedByPolicy`.                                                                                  |
| `preload_approved`                  | Kein lokales Consent-Panel (`confirmCapabilities` antwortet `true`). Stattdessen ein nicht blockierender Hinweis in der Statusleiste: "Von deiner Administration freigegeben", Tooltip und Live-Region nennen Name und Origin. Element kann trotzdem fragen (Ebene 1). |
| `identity_approved`                 | OpenID-Anfragen des Widgets gehen an Element (`openId: 'forward'` im Vermittler). Default aus: dann blockiert. Element fragt unter NeoBoards Identität bzw. merkt sich die Entscheidung für NeoBoard.                                                                  |
| nicht gelistete Widget-URL          | `unlisted: "deny"` (Default): kein Mount, Platzhalter "blockiert". `unlisted: "consent"`: Mount für erlaubte Origins mit der Standard-Allow-List (Poll) und lokalem Consent-Panel; die Origins aus `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS` zählen dann mit.        |
| `name`                              | Name für den Hinweis und für die Meldungen des Vermittlers. Vom Betreiber, daher vertrauenswürdiger als der Titel im Board.                                                                                                                                            |

**Bewusste Abweichungen vom Modul:**

- **Ohne Query und Hash.** Das aktuelle Modul vergleicht die rohe
  `templateUrl` (Abschnitt 5.1). Für NeoBoard wäre das falsch herum: Die URL
  im Board ist Nutzereingabe, Query und Hash tragen nur Parameter, die der
  Vermittler selbst einsetzt. Mit Rohvergleich bräuchte jede Regel `*`, und ein
  angehängtes `?…` oder `#…` könnte die gewählte Regel verschieben. Wir
  vergleichen deshalb Origin + Pfad, wie das ältere Nordeck-Modul.
- **Normalisierung und strenge Muster.** Die URL wird mit `new URL()`
  normalisiert (Host klein, Default-Port weg, `..` aufgelöst). Muster müssen
  schon in dieser Form stehen, sonst ist die Policy ungültig. Damit ist
  `https://poll.example.org*` (passt im Modul auch auf
  `https://poll.example.org.attacker.example/`) ein Fehler mit Korrekturvorschlag.
- **Spezifität.** Eine exakte Regel schlägt jedes Glob, unter Globs gewinnt
  das längste Präfix. Im Modul gewinnt die alphabetisch spätere Regel, also
  `/*` gegen die exakte Regel (Abschnitt 5.2).
- **Kein feldweises Mergen.** Die gewinnende Regel gilt vollständig. Im Modul
  könnte eine breite Regel mit `preload_approved: true` einer schmalen Regel
  die Vorab-Genehmigung vererben.
- **Nicht gelistet heißt verweigert.** Das Modul reicht Unbekanntes an den
  Dialog weiter; NeoBoard blockiert (Allow-List).
- **Keine Capability-Globs.** `*` in `capabilities_approved` ist ein Fehler.
- **Fail closed.** Jeder Fehler (kein Objekt, falsche Typen, falsches Muster,
  Glob, zu viele Regeln oder Einträge, kaputtes JSON/Base64) macht die ganze
  Policy ungültig. Dann ist die Einbettung aus, auch wenn
  `REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS` gesetzt ist; die Konsole meldet
  `[embedded widgets] …`. Unbekannte Felder sind nur Warnungen (Tippfehler wie
  `preload_aproved` wirken in die sichere Richtung).
- **"Load widget" bleibt manuell.** Im Modul meint `preload_approved` den
  Lade-Hinweis. In NeoBoard entspricht dem das Consent-Panel; das Aktivieren
  bleibt eine Nutzeraktion, damit nicht jedes Board beim Öffnen iframes
  startet und Daten an innere Widgets gibt.

**Origins:** Mit Policy zählen die Origins der Regeln. Ist zusätzlich
`REACT_APP_EMBEDDED_WIDGET_ALLOWED_ORIGINS` gesetzt, ist sie eine Obergrenze
(Schnittmenge, mit Warnung für gestrichene Origins). So kann eine fehlerhafte
Policy die Env-Liste und `CSP_FRAME_SRC` nicht erweitern. Ohne Policy gilt die
Env-Liste allein, wie bisher (Kompatibilität: Standard-Allow-List, lokales
Consent-Panel für jedes Widget, kein OpenID).

**Capabilities:** Mit Policy entscheidet `capabilities_approved` der Regel.
Ist zusätzlich `REACT_APP_EMBEDDED_WIDGET_ALLOWED_CAPABILITIES` gesetzt, ist
sie (zusammen mit der Poll-Standardliste) eine Obergrenze wie die
Origin-Liste: Regeln und Initial-Union behalten nur Einträge, die dort
stehen, gestrichene meldet die Konsole als Warnung. Die Env-Liste erweitert
nie eine Regel und nie die Standardliste nicht gelisteter Widgets
(`unlisted: "consent"`). Ohne Policy ist sie die Erweiterung der
Standardliste für alle erlaubten Widgets. Harte Deny-List und die
Board-eigenen Event-Typen gelten immer.

`CSP_FRAME_SRC` bleibt statisch und begrenzt beides nach oben, auch bei einem
JS-Fehler.

### 9.2 Grenzen von Ebene 1

- NeoBoard kann sich bei Element **nicht selbst** vorab genehmigen. Das ist so
  gewollt: Die Entscheidung liegt beim Client bzw. beim Betreiber des Clients.
- Ohne Lifecycle-Modul (app.element.io oder fremdes Element) sieht der Nutzer
  immer Elements Dialog. Ebene 2 ändert daran nichts. Sie entscheidet nur, was
  NeoBoard an innere Widgets weitergibt und was es überhaupt bei Element
  anfragt.
- Der Element-Dialog nennt NeoBoard, nicht Poll. NeoBoard erklärt das in der
  eigenen UI (Panel "Bitte im Dialog deines Matrix-Clients bestätigen").

### 9.3 Vereinigung in der Initialanfrage

**Vorschlag:** NeoBoard fordert schon in seiner **ersten** Capability-Anfrage
`NeoBoard-Caps ∪ alle per Policy erlaubten Caps eingebetteter Widgets` an.

Wirkung:

- Ohne Modul: **genau ein** Element-Dialog. Mit "Remember" speichert Element die
  vollständige Liste (gespeichert wird `allowedSoFar ∩ requested` der letzten
  Anfrage, und die ist hier vollständig). Nach einem Reload kommt kein Dialog.
- Eingebettete Widgets erben die Grants (`inherited`, `broker.isApproved` →
  `outerApi.hasCapability`). Es gibt keine Nachforderung, also kann der
  Remember-Fehler nicht auftreten. Zusätzlich `maxCapabilityRequests: 0`
  setzen, damit spätere Fälle nicht doch eine Runde auslösen, die die gemerkte
  Liste überschreibt.
- Mit Modul: Die Regel muss dieselbe Vereinigung enthalten. Das tut sie bereits
  (4.1).

**Umsetzung:** `REACT_APP_EMBEDDED_WIDGET_INITIAL_UNION=true` (Default aus).
NeoBoard ruft `WidgetApiImpl.create({ capabilities })` synchron beim Laden
des Moduls auf (`matrix-neoboard-widget/src/index.tsx`). Ein `fetch` vor
`create` würde den Handshake verpassen: Element sendet `capabilities` nach dem
iframe-`load`, und kommt die Anfrage vor dem Listener an, geht sie verloren.
Deshalb liest NeoBoard Schalter und Policy synchron aus
`window.__ENVIRONMENT__` bzw. `import.meta.env` (9.1) und hängt an seine
eigene Liste die Vereinigung von `capabilities_approved` aller Regeln an,
deren Origin erlaubt ist, abzüglich Hard-Deny-Liste und NeoBoards eigener
Typen, ohne Duplikate. Ohne gültige Policy wirkt der Schalter nicht (Warnung
in der Konsole). Zusätzlich setzt NeoBoard `maxCapabilityRequests: 0` und
fordert in der Hülle deklarierte Capabilities nicht vorab an, damit keine
spätere Runde die gemerkte Liste überschreibt. Hat der Nutzer im ersten Dialog
etwas abgelehnt, bekommt das innere Widget nur, was erteilt wurde
(`deniedUpstream`), bis zum nächsten Reload.

Die lokale Zustimmung in NeoBoard (Panel oder, bei `preload_approved`, der
Hinweis) bleibt davon unberührt: Ererbte Grants gehen nie ohne sie an ein
inneres Widget.

| Kriterium                           | Vereinigung initial                                                         | Nachforderung bei Bedarf (heute)                                        |
| ----------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Element-Dialoge ohne Modul          | 1 (länger, ca. 39 Einträge)                                                 | 1 plus 1 je neuem Widget-Typ; nach Reload erneut (Remember-Fehler)      |
| Remember-Fehler                     | tritt nicht auf                                                             | tritt auf                                                               |
| Minimalprinzip                      | schlechter: Poll-Grants auch auf Boards ohne Poll, für jeden Nutzer         | besser: Grants nur, wenn ein Widget tatsächlich eingebettet ist         |
| Verständlichkeit des Dialogs        | schlechter: Poll-Rechte beim Öffnen eines Whiteboards, ohne Kontext         | besser: Dialog erscheint beim Laden des Widgets, NeoBoard kann erklären |
| Komplexität                         | geringer (keine MSC2974-Runden über zwei Ebenen)                            | höher (Serialisierung, Budget, Timeouts)                                |
| Neue Widget-Typen                   | Konfigurationsänderung plus Reload; alle Nutzer bekommen einen neuen Dialog | automatisch                                                             |
| Mit Lifecycle-Modul                 | gleich gut (kein Dialog)                                                    | gleich gut (kein Dialog, Abschnitt 6)                                   |
| Wirkung bei Widget-Kompromittierung | größer: Poll-Grants liegen dauerhaft bei NeoBoard                           | kleiner, solange kein Widget eingebettet ist                            |

**Empfehlung:**

- Mit Lifecycle-Modul (Stufe 2): Nachforderung bei Bedarf. Das Modul nimmt die
  Dialoge weg, und Grants entstehen nur, wenn sie gebraucht werden.
- Ohne Modul (Stufe 1 auf fremdem Element) mit festem, kleinem Widget-Katalog,
  z. B. nur Poll: die Vereinigung initial anfragen, per Betreiber-Schalter.
  Dazu `maxCapabilityRequests: 0`.

Beide Wege nutzen dieselbe Policy als Quelle.

## 10. Generator

```sh
yarn install   # der Generator nutzt prettier aus dem Repo
node neoboardception-docs/examples/generate-lifecycle-config.mjs          # schreibt examples/*
node neoboardception-docs/examples/generate-lifecycle-config.mjs --check  # bricht bei Abweichung ab
node neoboardception-docs/examples/generate-lifecycle-config.mjs --print \
  --neoboard-url https://neoboard.example.org --poll-url https://poll.example.org \
  --rtc matrixrtc --module-url /modules/widget-lifecycle/index.js
```

- Liest `matrix-neoboard-widget/src/widgetCapabilities.ts`. Die Konstanten löst
  er aus `packages/react-sdk/src` auf, die Bibliothekskonstanten aus einer
  gepinnten Tabelle (matrix-widget-api 1.19.0, Toolkit 5.1.0). Außerdem liest er
  `POLL_CAPABILITIES` aus `packages/widget-mediation/src/capabilities.ts`.
- Unbekannte Konstrukte oder Konstanten **brechen ab**. Globs in
  `POLL_CAPABILITIES` brechen ebenfalls ab.
- Erzeugt: `config.runtime.json` (A), `config.legacy-build.json` und
  `build_config.yaml` (B), `embedded-widgets.policy.json` (Ebene 2, lesbar)
  und `neoboard.env.example` mit derselben Policy als
  `REACT_APP_EMBEDDED_WIDGET_POLICY=base64:…`. Ein Test
  (`matrix-neoboard-widget/src/embeddedWidgets/config.test.ts`) prüft, dass
  beide Beispiele gültig sind und dieselbe Wirkung haben.
- `--check` gehört in die CI, damit Änderungen an NeoBoards oder Polls
  Capability-Liste nicht unbemerkt an den Regeln vorbeilaufen.
- Optionen: `--no-modals`, `--omit <cap,…>` (Abschnitt 4.1), `--preapprove`
  (`preload_approved` für Poll in NeoBoards Policy), `--initial-union`
  (Schalter in `neoboard.env.example` aktiv statt auskommentiert).

## 11. Verifikation nach Gate 2 (Checkliste)

Aufbau: selbst betriebenes Element, Variante A (bzw. A'). config.json aus dem
Generator mit echten Origins. NeoBoard-Build mit Renderer und ohne Spike.
Poll auf eigener Origin. Testkonten, frisches Browserprofil
(`localStorage` leer, damit keine gemerkten Grants mitspielen).

1. [ ] Modul geladen: In der Konsole erscheint kein `No configuration found …`
       und kein `Failed to init module`. `window.mxModuleLoader` existiert.
       Bei A' ist das Modul nicht doppelt eingetragen.
2. [ ] Board öffnen (Raum-Widget, von einem anderen Admin angelegt): **kein**
       Preload-Dialog, **kein** Capability-Dialog. Im MatrixRTC-Modus erscheint
       nur der erwartete OpenID-Dialog.
3. [ ] Poll einbetten und aktivieren: **kein** Element-Dialog. In den
       Konsolen-Logs von matrix-widget-api: Nachforderung mit den 11 Delta-Caps,
       danach `notify_capabilities` mit der Vereinigung (39 bei matrixrtc).
4. [ ] Abstimmen und Poll starten funktionieren. Die Events kommen im Raum an,
       gegengeprüft über die Client-Server-API.
5. [ ] Poll anlegen (Modal `/create-poll`) und Gruppe anlegen
       (`/admin/create-group`): Das Modal öffnet ohne Capability-Dialog. Das
       Ergebnis landet im Raum.
6. [ ] Reload: wieder kein Dialog. `localStorage` `widget_<NeoBoard-ID>_approved_caps`
       wurde nicht durch eine Teilliste überschrieben.
7. [ ] Negativtest Element: Eine Capability aus der Regel entfernen (z. B.
       `…receive.event:net.nordeck.poll.vote`). Erwartet: Element-Dialog **nur**
       für diese Capability. Das zeigt, dass das Modul nicht verweigert,
       sondern durchreicht. Ablehnen: Poll zeigt `MissingCapabilitiesError`,
       NeoBoard läuft weiter.
8. [ ] Negativtest Vermittler: Ein Test-Widget von einer gelisteten Origin
       fordert eine nicht gelistete Capability an (z. B.
       `org.matrix.msc2762.send.state_event:m.room.topic` oder
       `org.matrix.msc2931.navigate`). Erwartet: **kein** Element-Dialog,
       `blockedByPolicy` enthält sie, sie taucht in keiner Nachforderung auf.
9. [ ] Negativtest Origin: Ein Board-Element mit nicht gelisteter Origin zeigt
       nur den Platzhalter. Die CSP-Konsole meldet `frame-src`, wenn man das
       Mounten erzwingt.
10. [ ] Negativtest URL-Muster: Eine exakte Regel `https://neoboard.example.org/`
        statt `/*` führt bei Variante A zu Dialogen. Damit ist Abschnitt 5.1
        bestätigt.
11. [ ] Modal-Regel eng: Ein Modal auf einem anderen Poll-Pfad oder einer
        anderen Origin bekommt einen Dialog, keine stille Genehmigung.
12. [ ] Nachforderung ohne neue Capabilities (Poll "Retry"): kein Dialog. Die
        Grants im Vermittler bleiben vollständig (doppeltes `notify_capabilities`,
        Abschnitt 6).
13. [ ] Verschlüsselter Raum: Schritte 3 und 4 wiederholen.
14. [ ] Ebene 2, `preload_approved: true` für Poll: kein NeoBoard-Panel, die
        Statusleiste zeigt "Von deiner Administration freigegeben".
        `preload_approved: false`: Panel erscheint.
15. [ ] Ebene 2, ungültige Policy (z. B. `https://poll.example.org` ohne `/`):
        Konsole meldet `[embedded widgets] …`, Platzhalter "blockiert", keine
        Einfügeaktion.
16. [ ] Initial-Union ohne Modul: genau ein Element-Dialog beim Start (mit
        den Poll-Capabilities), keiner beim Aktivieren von Poll, nach Reload
        keiner.

## 12. Offene Punkte

- Verteilung des Moduls für Variante A ohne Docker-Image: Das Paket im
  element-web-Monorepo ist `private`. Es gibt das Release-Archiv
  (`module/widget-lifecycle/v1.1.0`). Prüfen, ob dessen Inhalt als
  selbst gehostetes Bundle dokumentiert ist.
- In welchem Element-Release fehlt `build_config.yaml` zum ersten Mal? Bekannt
  ist nur das Merge-Datum von PR #33941 (2026-09-11).
- `send.state_event:m.room.power_levels#` vorab genehmigen oder als einzigen
  Dialog belassen? Das ist eine Betreiberentscheidung (Abschnitt 4.1).
- Ebene 2 und Initial-Union sind umgesetzt und unit-getestet; die Prüfung in
  einem echten Element steht aus (Abschnitt 11, Punkte 14–16).
- Eingebettete Widgets müssen vom Betreiber vertraut sein: nur Allow-List,
  vom Betreiber gehostet, versionsgepinnt. Ein eingebettetes Widget hat
  dasselbe Vertrauen wie NeoBoard selbst. Die Regeln dieses Dokuments sind
  Schadensbegrenzung, keine Isolation.
