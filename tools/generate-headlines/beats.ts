import type { Sector } from '../../shared/types.ts';

type Industry = {
  product: readonly string[];
  operation: readonly string[];
  rule: readonly string[];
};

export const beats: Record<Sector, Industry> = {
  tech: {
    product: ['cloud services', 'AI accelerator chips', 'warehouse sensors', 'password managers', 'mobile modems', 'database licenses'],
    operation: ['data center', 'chip packaging', 'device repair', 'software deployment', 'network maintenance'],
    rule: ['data residency', 'chip exports', 'app store billing', 'digital privacy', 'right to repair'],
  },
  energy: {
    product: ['grid batteries', 'geothermal power', 'offshore wind turbines', 'jet fuel', 'natural gas', 'solar inverters'],
    operation: ['pipeline', 'refinery', 'wind farm', 'well servicing', 'substation'],
    rule: ['drilling permits', 'methane reporting', 'grid access', 'offshore leases', 'electricity tariffs'],
  },
  defense: {
    product: ['radar systems', 'armored vehicle parts', 'flight simulators', 'satellite antennas', 'pilot helmets', 'naval engines'],
    operation: ['avionics production', 'shipyard', 'training range', 'depot maintenance', 'satellite integration'],
    rule: ['export controls', 'procurement audits', 'test range access', 'clearance screening', 'bid transparency'],
  },
  airlines: {
    product: ['regional flights', 'air cargo', 'red-eye services', 'premium seating', 'aircraft maintenance', 'airport lounge passes'],
    operation: ['ground handling', 'baggage sorting', 'engine overhaul', 'crew scheduling', 'cargo terminal'],
    rule: ['landing rights', 'crew rest', 'passenger refunds', 'baggage fees', 'runway noise'],
  },
  finance: {
    product: ['payment services', 'mortgages', 'crop insurance', 'small business loans', 'prepaid cards', 'retirement accounts'],
    operation: ['clearing network', 'branch network', 'mortgage servicing', 'claims processing', 'card settlement'],
    rule: ['capital reserves', 'interchange fees', 'loan disclosures', 'deposit insurance', 'stress testing'],
  },
  health: {
    product: ['diagnostic devices', 'infusion pumps', 'generic drugs', 'home testing kits', 'surgical implants', 'telehealth subscriptions'],
    operation: ['device assembly', 'clinical trial', 'sterile packaging', 'sample processing', 'patient support'],
    rule: ['clinical approval', 'patient privacy', 'hospital reimbursement', 'drug labeling', 'device inspections'],
  },
};
