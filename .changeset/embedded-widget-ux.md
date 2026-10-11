---
'@nordeck/matrix-neoboard-react-sdk': minor
'@nordeck/matrix-neoboard-widget': minor
'@nordeck/matrix-widget-mediation': minor
---

Embedded widgets: a remote change of the widget URL deactivates a running widget (consent is remembered per widget URL, not per origin); localised error messages with error codes and no retry for permanent errors; the board's own origin is dropped from the allow-list; "Embed" stays disabled while the URL is not allowed; the status bar shows permissions that are not available here and "Not supported here" when a widget cannot work; the placeholder shows origin and path without template parameters; a "Leave widget" button leaves the interaction; deleting an element with a running call asks first.
