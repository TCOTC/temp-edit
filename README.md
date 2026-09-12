# Temp Edit

Adds a top bar button that opens a "Temp Edit" tab powered by the Protyle Lite editor.

## Features

* Desktop only, since custom tabs rely on the desktop layout
* One click on the top bar opens the temp edit tab; clicking again switches to the opened tab
* Uses Protyle Lite, so Markdown WYSIWYG input, the slash menu and block references all work
* Content stays in the tab and is **never written to the workspace `data/`**; it is lost when the tab is closed
* Copy the content as Markdown or clear it with one click

## Why nothing is persisted

* Protyle runs with `lite: true`, so edit transactions are recorded by the frontend `LocalUndo` and `/api/transactions` is never called
* The editor has no block ID (`blockId: ""`), so it neither reads nor writes any document
* The upload URL is empty, so pasting images and other assets fails instead of writing to `data/assets`

## Changelog

### v1.0.0

* Initial release
