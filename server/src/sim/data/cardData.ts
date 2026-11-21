/**
 * The card catalog the sim uses by default. The catalog belongs to the design side
 * (shared/data/cards.json, schema and validator in shared/cards.ts); this file only points at it.
 */
import catalogJson from '@tg/shared/data/cards.json';
import type { CardCatalogEntry } from '@tg/shared/cards';

export const DEFAULT_CATALOG = catalogJson as CardCatalogEntry[];
