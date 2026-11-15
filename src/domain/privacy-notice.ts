import type { Locale } from "@/lib/i18n";

/**
 * The privacy notice, in English.
 *
 * Kept as data rather than JSX for one reason: a notice that exists in one language and is translated
 * inline tends to drift, and a drifted translation of a privacy notice is worse than none — it states
 * a different promise in a language the reviewer cannot read. Both languages sit here side by side so
 * a change to one is a visible change to the other.
 *
 * This is a draft. The `draftBanner` says so on the page, in whatever language the reader is using,
 * because a warning only in English is not a warning to somebody who does not read English.
 */

export type PrivacyParagraph = { lead: string | null; body: string };
export type PrivacySection = { heading: string; paragraphs: PrivacyParagraph[] };

type Notice = {
  eyebrow: string;
  title: string;
  intro: string;
  draftBannerStrong: string;
  draftBannerWithContact: string;
  draftBannerWithoutContact: string;
  sections: PrivacySection[];
  contactHeading: string;
  noContact: string;
  controller: (name: string, jurisdiction: string | null) => string;
};

/**
 * The notice in the requested language, and whether it is actually in that language.
 *
 * Hindi and Bengali are offered by the switcher but this notice is not translated into them. Returning
 * English silently would be the exact failure this whole file argues against — a person who asked for
 * Hindi would read a full page of English and conclude the page is the Hindi version. So the caller is
 * told, and the page prints a banner saying so in the reader's own language.
 *
 * When a translation arrives, add it to the record above and this function needs no change.
 */
export function noticeFor(locale: Locale): { notice: Notice; translated: boolean } {
  const noticed = privacyNotice[locale];
  return noticed ? { notice: noticed, translated: true } : { notice: privacyNotice.en, translated: false };
}


export const privacyNotice: Partial<Record<Locale, Notice>> & Record<"en", Notice> = {
  en: {
    eyebrow: "Your information",
    title: "Privacy, by design.",
    intro: "This draft describes the intended principles. It is not a final privacy notice and must not be used to onboard real people until reviewed and approved.",
    draftBannerStrong: "DRAFT — REQUIRES QUALIFIED PRIVACY AND LEGAL REVIEW.",
    draftBannerWithContact: "A data-protection contact is recorded below.",
    draftBannerWithoutContact: "Data controller, contact, retention periods, processors and lawful bases are not yet confirmed.",
    sections: [
      {
        heading: "Information the service may use",
        paragraphs: [{
          lead: null,
          body: "Accounts require an email address and name. Partner onboarding may include organisation details, operational contacts, service area and restricted verification documents. Delivery records may include donation details, custody events, incident reports and receipts.",
        }],
      },
      {
        heading: "Why it is used",
        paragraphs: [{
          lead: null,
          body: "Information is intended to support account security, organisation review, donation coordination, delivery traceability, support and incident response. The final purposes and legal bases must be confirmed for the actual operating model.",
        }],
      },
      {
        heading: "Access and retention",
        paragraphs: [
          {
            lead: null,
            body: "Access is role- and organisation-scoped. Verification documents are intended to remain private. Which retention periods apply is still a legal decision nobody has signed off, so this draft states only what the software actually enforces today.",
          },
          {
            lead: "What runs.",
            body: "A job sweeps every night at 03:15 IST and deletes read notifications after 90 days, spent one-time sign-in codes after 1 day, expired delivery codes after 30 days, and failed email dead letters after 30 days. It scrubs the free text from closed safety incidents after two years and from audit records after six years, keeping the record itself. Before any sweep an operator can preview the exact number of rows affected, produced by the same code, and that preview changes nothing.",
          },
          {
            lead: "What stops it.",
            body: "A legal hold on a person, an organisation, a delivery job or a donation outranks every window. A held record is never deleted, the hold cannot be removed — only released by a named member of staff with a reason — and the number of rows kept back is shown on every sweep.",
          },
          {
            lead: "What is never deleted.",
            body: "Audit records and delivery receipts are not deleted by retention, because they are the evidence of what happened to the food. Beyond six years only the free text inside an audit record goes; who did what, when and to which record remains.",
          },
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          {
            lead: "Erasure.",
            body: "A person can ask for erasure. Fulfilling it overwrites their name, email and credentials and ends their sessions, while keeping the receipts and audit trail that answer for the food. The erasure is itself recorded in the audit trail.",
          },
          {
            lead: "Getting your data.",
            body: "Any signed-in person can produce one file containing everything this service holds about their account — profile, memberships, notifications, donations, receipts, custody events, support and privacy requests, and the retention actions that ran — from their profile page. The download is recorded as a disclosure in the audit trail.",
          },
          {
            lead: "Correcting something.",
            body: "You can change your own display name, and the change is recorded. Your email address, a partner's phone number, an organisation's registered name and a verification status are records other people act on, so those go through a reviewed request instead of a silent edit.",
          },
          {
            lead: "Asking to be erased.",
            body: "Erasure is a reviewed request rather than a button, because it ends your sign-in methods and cannot be undone. When it is approved, your name, email and credentials are overwritten and your sessions destroyed, in the same step that closes the request — the two cannot come apart. Your receipts and the audit trail are kept, because they answer for what happened to the food.",
          },
        ],
      },
      {
        heading: "How long we take",
        paragraphs: [{
          lead: null,
          body: "No response window has been recorded yet, so none is promised here. A number will appear only once somebody has committed to it and can be held to it.",
        }],
      },
      {
        heading: "What is not settled",
        paragraphs: [{
          lead: null,
          body: "The retention numbers above are defaults, not an approved policy, and the full period list requires qualified privacy and legal review before real operations. Rectification of an email address or partner contact details is handled by a human rather than automatically. Rectification and grievance handling have no escalation path beyond the operations screen flagging an overdue item.",
        }],
      },
    ],
    contactHeading: "Contact and rights",
    noContact: "No public privacy contact has been configured. Do not submit sensitive personal data through this draft site. A reviewed notice and named grievance route are required before launch.",
    controller: (name, jurisdiction) => `Controller: ${name}${jurisdiction ? `, ${jurisdiction}` : ""}.`,
  },
};

/**
 * The response-window sentence, which differs by language *and* by what is recorded.
 *
 * Kept as a function rather than a substitution because Hindi and Bengali put the number and the
 * clause in a different order from English. A `{hours}` slot would produce word salad in two of the
 * three.
 */
export function responseWindowParagraph(
  locale: Locale,
  window: { hours: number | null; staffedBy: string | null },
): string {
  if (window.hours === null) {
    if (locale === "hi") return "अभी कोई उत्तर-समय दर्ज नहीं है, इसलिए यहाँ कोई वादा नहीं है।";
    if (locale === "bn") return "এখনও কোনো উত্তরের সময়সীমা নথিভুক্ত হয়নি, তাই এখানে কোনো প্রতিশ্রুতি নেই।";
    return "No response window has been recorded yet, so none is promised here.";
  }
  if (locale === "hi") {
    const who = window.staffedBy ? ` — उस समयसीमा पर ${window.staffedBy} उत्तर देते हैं` : "";
    return `हम निजता और सहायता अनुरोधों का उत्तर ${window.hours} घंटे के भीतर देते हैं${who}। यह संख्या संचालन रजिस्टर में दर्ज है, और इससे अधिक समय लेने वाला अनुरोध अतिदेय गिना जाता है — इसलिए देरी चुपचाप नहीं बढ़ती, दिखाई देती है।`;
  }
  if (locale === "bn") {
    const who = window.staffedBy ? ` — ওই সময়সীমায় ${window.staffedBy} উত্তর দেন` : "";
    return `আমরা গোপনীয়তা ও সহায়তার অনুরোধের উত্তর ${window.hours} ঘণ্টার মধ্যে দিই${who}। এই সংখ্যাটি পরিচালনা রেজিস্টারে নথিভুক্ত, এবং এর বেশি সময় নেওয়া অনুরোধ বিলম্বিত হিসেবে গণ্য হয় — তাই দেরি চুপচাপ বাড়ে না, দেখা যায়।`;
  }
  const who = window.staffedBy ? ` — ${window.staffedBy} is on the other end of that window` : "";
  return `We answer privacy and support requests within ${window.hours} hours${who}. That number is the one recorded on the operations register, and anything past it is counted as overdue, so a request that slips the window shows up rather than ageing quietly.`;
}
