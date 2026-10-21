---
'@nordeck/matrix-neoboard-react-sdk': minor
---

View-only mode for users who may not send board snapshots (`net.nordeck.whiteboard.document.snapshot`): no tools, undo/redo, slide/frame list, presentation controls, editing shortcuts or image drop, and no own cursor broadcast. Every client now ignores real-time document updates and presentation/focus messages from users without that permission, a view-only client no longer tries to send snapshots, and two view-only users no longer open a WebRTC connection to each other.
