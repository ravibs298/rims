import { unprocessable } from '../../errors';

/**
 * Extensible RFID integration point. A reader adapter turns whatever a reader/middleware sends
 * (raw hex, URN, vendor payload...) into a canonical tag id that is looked up in product_identifiers.
 * To support a vendor: implement RfidAdapter and call registerRfidAdapter() at startup.
 */
export interface RfidAdapter {
  name: string;
  normalize(raw: string): string;
}

export const genericEpcAdapter: RfidAdapter = {
  name: 'generic',
  normalize(raw: string) {
    const v = raw.trim().replace(/^urn:epc:raw:[^:]*:/i, '').replace(/[\s:-]/g, '').toUpperCase();
    if (!/^[0-9A-F]{8,48}$/.test(v)) throw unprocessable('INVALID_RFID_TAG', 'RFID tag must be 8-48 hexadecimal characters (EPC)');
    return v;
  },
};

const registry = new Map<string, RfidAdapter>([[genericEpcAdapter.name, genericEpcAdapter]]);

export const registerRfidAdapter = (a: RfidAdapter) => void registry.set(a.name, a);
export const listRfidAdapters = () => [...registry.keys()];
export function getRfidAdapter(name = 'generic'): RfidAdapter {
  const a = registry.get(name);
  if (!a) throw unprocessable('UNKNOWN_RFID_READER', `No RFID adapter registered with name "${name}"`);
  return a;
}
