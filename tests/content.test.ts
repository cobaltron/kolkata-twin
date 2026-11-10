import { describe, expect, it } from 'vitest';
import { PathNetwork } from '../src/layers/traffic/PathNetwork';
import { activityByHour } from '../src/layers/traffic/TrafficLayer';
import { creditFromCommons, introFromWikitext } from '../tools/lib/wikitext';

describe('introFromWikitext', () => {
  const article = `{{Short description|Test}}
{{Infobox building
| name = Test Hall
}}
The '''Test Hall''' is a [[marble]] building in [[Kolkata|Calcutta]].<ref name="a">Some book</ref> It is {{convert|338|by|228|ft|m|abbr=on}} and rises to {{convert|184|ft|m}}.

== History ==
Later text.`;
  it('keeps the first paragraph as plain text and preserves stated quantities', () => {
    expect(introFromWikitext(article)).toBe('The Test Hall is a marble building in Calcutta. It is 338 by 228 ft and rises to 184 ft.');
  });
  it('refuses text it cannot clean rather than showing markup', () => {
    expect(introFromWikitext('A paragraph with a stray table cell | and enough length to be chosen as the intro of the article here.')).toBeNull();
  });
});

describe('creditFromCommons', () => {
  it('reads licence and author', () => {
    const page = '{{Information\n|description=x\n|author=[[User:Someone|Some One]]\n}}\n{{self|cc-by-sa-4.0}}';
    expect(creditFromCommons(page)).toEqual({ licence: 'CC BY-SA 4.0', author: 'Some One' });
  });
  it('returns null when there is no recognised licence, so the photo is not used', () => {
    expect(creditFromCommons('{{Information|author=x}}')).toBeNull();
  });
});

describe('PathNetwork', () => {
  // Two ways meeting end to end at (100, 0), plus a branch.
  const set = { xy: Float32Array.from([0, 0, 100, 0, 100, 0, 100, 80, 100, 0, 200, 0]), offsets: Uint32Array.from([0, 4, 8, 12]) };
  const net = new PathNetwork(set);
  it('measures paths and continues onto a connected way at a junction', () => {
    expect(net.totalLength).toBeCloseTo(280, 5);
    const c = { path: 0, s: 90, dir: 1 as const, seg: 0 };
    net.advance(c, 30, 0); // 10 m to the junction, then 20 m along the first connected way
    expect(c.path).toBe(1);
    expect(c.s).toBeCloseTo(20, 5);
    const pose = net.pose(c, { x: 0, y: 0, dx: 0, dy: 0 });
    expect([pose.x, pose.y, pose.dx, pose.dy].map((v) => Math.round(v))).toEqual([100, 20, 0, 1]);
  });
  it('turns round at a dead end', () => {
    const c = { path: 1, s: 70, dir: 1 as const, seg: 0 };
    net.advance(c, 30, 0);
    expect(c.dir).toBe(-1);
    expect(c.s).toBeCloseTo(60, 5);
  });
});

describe('activityByHour', () => {
  it('is quiet at night and busy at the peaks, within 0..1', () => {
    expect(activityByHour(3)).toBeLessThan(0.25);
    expect(activityByHour(10)).toBeGreaterThan(0.9);
    for (let h = 0; h < 24; h++) expect(activityByHour(h)).toBeLessThanOrEqual(1);
  });
});
