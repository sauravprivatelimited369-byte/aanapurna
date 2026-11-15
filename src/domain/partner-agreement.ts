/**
 * The partner agreement, as text, versioned.
 *
 * `OPERATING_MODEL.md` names "a written partner agreement stating who is responsible for which
 * stage, and what happens on harm" as a launch requirement. This module is that text made
 * checkable: an organisation cannot be verified until a named member has accepted a specific
 * version, the acceptance is stored with the SHA-256 of exactly what was shown, and bumping
 * `AGREEMENT_VERSION` makes every earlier acceptance visibly stale.
 *
 * **This is not a legally reviewed contract.** It is a plain-language allocation of responsibility
 * written to be understood by a canteen manager, and it is labelled as such everywhere it appears.
 * `LEGAL_RESEARCH_REGISTER.md` and `LAUNCH_CHECKLIST.md` both require counsel to review it before
 * real food moves. Do not describe it as a contract, a licence, insurance or a certification.
 *
 * Edit the obligations deliberately. Every change here is a new version, which means every partner
 * has to read and accept it again — that friction is the point.
 */

export const AGREEMENT_VERSION = "2026-11-15";

export type AgreementClause = {
  heading: string;
  body: string;
};

export const PARTNER_AGREEMENT_CLAUSES: readonly AgreementClause[] = [
  {
    heading: "What Annapurna Link is",
    body:
      "Annapurna Link is a record-keeping and coordination service. It introduces organisations that have surplus food to organisations that can use it, and it keeps a record of who declared what, who collected it, who inspected it and when. It does not prepare, cook, store, transport, inspect, test, certify, insure or approve any food. It does not guarantee that any food is safe. It is not a food business operator, a caterer, a laboratory or a regulator.",
  },
  {
    heading: "What the food Generator is responsible for",
    body:
      "The Generator is responsible for the condition and the truth of the declaration of every item it lists. This includes: that the food was prepared and handled in premises it is entitled to operate; that the preparation time, packing time and best-before time entered are accurate; that the ingredient and allergen list is complete enough for a Receiver to make a decision; that storage before collection matched what was declared; and that nothing known to be unsafe, recalled, spoiled or adulterated is listed. If the Generator becomes aware of a problem after listing, it must report it through the incident process immediately, including after handover.",
  },
  {
    heading: "What the delivery Helper is responsible for",
    body:
      "The Helper is responsible for collecting within the agreed window and keeping the food as instructed, including any temperature or packaging instruction declared by the Generator. The Helper records what they observed at collection and reports any concern rather than continuing silently. The Helper must not open, repackage, mix or consume the food. A Helper who cannot complete a collection must release it or tell operations, so it can be reassigned.",
  },
  {
    heading: "What the receiving organisation is responsible for",
    body:
      "The Receiver is responsible for the decision to accept. Before accepting, it performs its own arrival checks: whether the seal and packaging are intact, whether the label matches what was declared, whether the food is within its declared window, and the temperature if its own procedure requires a reading. These checks are recorded in the application. The Receiver does not accept food it considers unsuitable, and it does not share the delivery verification code until it has completed those checks. After acceptance, the Receiver is responsible for how the food is stored and served, and for reporting any harm or suspected harm that becomes known afterwards.",
  },
  {
    heading: "What happens when something goes wrong",
    body:
      "Anyone who observes a problem records an incident. The incident can place the donation on hold, which stops further distribution of that batch. A recall records the reason, the author and every receipt already issued, and notifies everyone who may hold the food. A hold is not released by closing an incident; release is a separate decision by an authorised person. An incident cannot be closed until somebody records what was changed so the same failure cannot recur, and whether any person was harmed. A notification in the application is a courtesy; where a person may be at risk, the operators phone the receiving organisation.",
  },
  {
    heading: "Insurance, liability and the honest limit",
    body:
      "Each organisation remains responsible for its own acts and omissions and for meeting the requirements that apply to it, including any food-safety registration, licence, insurance and record-keeping obligation. Where the operator holds a liability position and insurance, it is recorded in the platform's declarations, and it is visible to operations together with the date it lapses. No insurance policy makes unsafe food safe, and nothing in this agreement transfers responsibility for food from the organisation that handled it to the software, its authors or the platform operator.",
  },
  {
    heading: "Personal data",
    body:
      "The application holds the minimum needed to coordinate a handover: contact details for each organisation, delivery records, and the identity of the person who made each decision. Delivery verification codes are visible only to the receiving organisation. Private verification documents are held in private storage and are never public. Requests to see, correct or remove personal data go through the support and data-request process. Audit and custody records are kept because they are the record of a handover, and they may prevent complete erasure of a person's name from historical events; where that applies the operator explains it in writing.",
  },
  {
    heading: "Acceptance",
    body:
      "By accepting, the person accepting confirms that they are authorised to act for the organisation named on this account, that they have read this agreement, and that the organisation will operate within the approved food-eligibility policy for its service area. If they are not authorised to bind the organisation, they must not accept.",
  },
];

/** The exact text a partner is shown. Hashed at acceptance so a later edit cannot rewrite history. */
export function partnerAgreementText(): string {
  return [`Annapurna Link partner agreement — version ${AGREEMENT_VERSION}`, ""]
    .concat(PARTNER_AGREEMENT_CLAUSES.flatMap((clause, index) => [`${index + 1}. ${clause.heading}`, clause.body, ""]))
    .join("\n")
    .trim();
}

/** Honest label for every surface that renders the text. */
export const AGREEMENT_STATUS_LABEL =
  "Plain-language responsibility agreement — not a legally reviewed contract. Counsel review is an open launch gate.";
