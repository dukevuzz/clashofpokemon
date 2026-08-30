# Changelog

## Unreleased

## 1.4.0 — 2026-08-31

### Added
- Accounts you can sign back into. A username and a password bind to the guest
  you already are, so nothing is left behind at the moment you decide to keep
  it. Guests still work and are still the default.
- A profile: your face, your name, your record, and the settings that used to
  have nowhere to live.
- Chests. Playing earns them, coins buy them, and each one holds six cards with
  the last always worth ending on.
- Shiny creatures — roughly one card in twenty, for the 338 species that have
  the art. A shiny is its own thing to own, so pulling one still counts as new.
- Twenty faces per creature. Repeated pulls pay shards for that creature, and
  shards buy its other faces. Tap anything in the collection to see what you
  have and what it would cost.

### Changed
- The menu, deck builder and Pokédex are pages now rather than drawings on a
  canvas: text at native resolution, real scrolling, and the same look
  throughout. One BATTLE button with a drawer beside it replaces the three
  separate mode buttons.
- The board sits on a lighter ground. Creature outlines were at 1.35:1 against
  the old one, which is below the point where an edge can be seen at all.
- Panels are painted rather than outlined rectangles, and the tab icons are
  drawn for this game.

### Fixed
- A destroyed tower now sits where it fell. It was drawn at the seat height of
  the creature that manned it, hanging up to 88px above its own footprint.
- Assets are cached properly. Everything shipped with `max-age=0`, so the CDN
  was never allowed to keep anything it was already storing.

## 1.3.1 — 2026-08-25

### Fixed
- The 24 newest creatures can be played online. They were in the collection
  and in your deck, but the server had never been told about them, so bringing
  one meant being turned away at the door.
- The "can Mega" filter shows whether it is on. It was gold either way.

## 1.3.0 — 2026-08-24

### Added
- Mega Evolution. Put a card in the first slot of your deck, get it to its
  final form, and a stone beside the arena fills as your elixir does. Three
  elixir turns that creature into its Mega for the rest of its life. One per
  match, and it keeps whatever damage it had already taken. Single player
  only for now.
- 24 more creatures, and the 38 Megas they lead to.
- Drag your deck to reorder it. The collection filters down to the cards that
  can Mega.
- Four arenas, one dealt per match. In one of them the river is lava.

### Changed
- New board art.

## 1.2.0 — 2026-08-22

### Fixed
- Sharper on phones. The board was drawn at one size for every device and the
  phone stretched it to fit, which softened everything.

## 1.1.0 — 2026-08-21

### Fixed
- Towers behave the same at both ends of the board. Before this you could hit
  their tower from further away than they could hit yours.
- Your deck no longer comes back empty when cards leave the roster.
- Cards that deal no damage stopped claiming they do. Eevee said it hit for 47
  while giving you elixir.

### Changed
- Releases deploy from a tag. Nothing logs into the server any more.

### Added
- A licence, and credits naming the 40 artists whose sprites are in the game.

## 1.0.0 — 2026-08-20

First release. Two players, three minutes, six cards, 127 creatures.
