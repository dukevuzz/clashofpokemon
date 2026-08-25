# Changelog

## Unreleased

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
