import { expect, it } from 'vitest';
import { requiredShockCombos, normalizeText, validateHeadline } from '../../../shared/headlines.ts';
import { SECTORS } from '../../../shared/types.ts';
import { catalysts } from '../catalysts.ts';
import { headlineForms } from '../headline-forms.ts';

it('can fill the overnight target while reserving about a third of each bucket for comedy', () => {
  for (const combo of requiredShockCombos()) {
    const sectors = combo.scope === 'market' ? [undefined] : SECTORS;
    for (const sector of sectors) {
      const bucket = { ...combo, sector, kind: 'real' } as const;
      const straight = new Set<string>();
      const comic = new Set<string>();
      for (const { category, premise } of catalysts(bucket)) {
        const metadata = { ...bucket, category };
        const choices = headlineForms(premise, metadata);
        for (const text of [...choices.plain.slice(0, 1), ...choices.contextual]) {
          if (!validateHeadline({ ...metadata, id: 'capacity-test', text }).ok) continue;
          (category === 'absurd' ? comic : straight).add(normalizeText(text));
        }
      }
      const label = [combo.scope, sector, combo.direction, combo.magnitude].filter(Boolean).join('/');
      expect(straight.size, label).toBeGreaterThanOrEqual(34);
      expect(comic.size, label).toBeGreaterThanOrEqual(17);
    }
  }
});
