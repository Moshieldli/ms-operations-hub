import { postJson, pocomosOffice } from "./client";

/**
 * `interactionType` value used when the PhoneBurner webhook writes a call
 * note to a Pocomos customer.
 *
 * "Other" is the documented-working value from the API catalog (Section 12
 * of docs/REFERENCE.md). "Call" is the value we'd prefer because it shows up
 * with a phone icon in the Pocomos UI, but Pocomos may reject it as not in
 * the enum. Run `probeInteractionTypes()` (via scripts/probe-interaction-types.ts)
 * once against a real `url_id` to learn which values are accepted; if "Call"
 * works, change the constant below and ship.
 */
export const POCOMOS_CALL_INTERACTION_TYPE = "Other";

/**
 * Candidates the probe will try, in preference order. The first one that
 * returns 2xx wins.
 */
export const PROBE_CANDIDATES = ["Call", "Phone Call", "Phone", "Other"] as const;

export interface ProbeResult {
  candidate: string;
  status: number;
  ok: boolean;
  body: string;
}

/**
 * Send a throwaway note to `/jwt/pronexis/{office}/customer/{urlId}/note/create`
 * for each candidate `interactionType`. Returns one result per candidate so the
 * caller can decide which (if any) to hardcode.
 *
 * Caveat: every successful candidate creates a real note on the customer.
 * Use a test record (e.g. `Name="Postman", Lastname="Please Ignore"` rows
 * already created in past probing) and clean up afterwards.
 */
export async function probeInteractionTypes(urlId: string): Promise<ProbeResult[]> {
  const office = pocomosOffice();
  const results: ProbeResult[] = [];
  for (const candidate of PROBE_CANDIDATES) {
    let status = 0;
    let body = "";
    let ok = false;
    try {
      const resp = await postJson<unknown>(
        `/jwt/pronexis/${office}/customer/${urlId}/note/create`,
        {
          note: {
            interactionType: candidate,
            summary: `[probe] interactionType=${candidate} — safe to delete`,
            displayOnWorkorder: false,
            favorite: false,
            displayOnLoad: false,
            displayOnRouteMap: false,
            showOnTechApp: false,
          },
        }
      );
      ok = true;
      body = JSON.stringify(resp).slice(0, 200);
      status = 200;
    } catch (e) {
      const msg = (e as Error).message;
      const m = msg.match(/failed:\s*(\d+)\s*(.*)$/);
      status = m ? Number(m[1]) : 0;
      body = m ? m[2] : msg;
    }
    results.push({ candidate, status, ok, body });
  }
  return results;
}
