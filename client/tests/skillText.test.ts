import { describe, it, expect } from "vitest";
import { skillOf } from "../src/ui/skillText";
import { MOVE_EFFECT } from "../src/core/skills";
import { ALL, byId } from "../src/core/cards";

describe("what a card says its ability does", () => {
  it("never claims damage for a move that deals none", () => {
    // Eevee bought you elixir and claimed to deal 47, because the damage was
    // computed before anyone asked what the move was.
    for (const card of ALL) {
      if (!MOVE_EFFECT[card.skill ?? ""]) continue;
      const s = skillOf(card);
      expect(s.amount, `${card.id} (${card.skill})`).toBe(0);
      expect(s.summary, `${card.id} (${card.skill})`).not.toMatch(/Hits its target/);
    }
  });

  it("describes each kind of move in its own terms", () => {
    expect(skillOf(byId("eevee")!).summary).toMatch(/elixir/);
    expect(skillOf(byId("abra")!).summary).toMatch(/Jumps/);
    expect(skillOf(byId("togepi")!).summary).toMatch(/Restores/);
    expect(skillOf(byId("yamper")!).summary).toMatch(/shield/);
    expect(skillOf(byId("elgyem")!).summary).toMatch(/special defence/);
  });

  it("still reports damage for the moves that are damage", () => {
    const s = skillOf(byId("pikachu")!);
    expect(s.amount).toBeGreaterThan(0);
    expect(s.summary).toMatch(/Hits its target/);
  });
});
