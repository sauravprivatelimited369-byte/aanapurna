/**
 * The privacy notice, in Odia and English.
 *
 * Kept as data rather than JSX for one reason: a notice that exists in one language and is translated
 * inline tends to drift, and a drifted translation of a privacy notice is worse than none — it states
 * a different promise in a language the reviewer cannot read. Both languages sit here side by side so
 * a change to one is a visible change to the other.
 *
 * These are drafts. The `draftBanner` says so in both languages, because a person reading the Odia
 * version is entitled to the same warning the English version carries.
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

export const privacyNotice: Record<"or" | "en", Notice> = {
  or: {
    eyebrow: "ଆପଣଙ୍କ ସୂଚନା",
    title: "ଗୋପନୀୟତା, ଡିଜାଇନ୍ ଦ୍ୱାରା।",
    intro: "ଏହି ପ୍ରାରମ୍ଭିକ ଲେଖା ଆମର ଉଦ୍ଦେଶ୍ୟ ବର୍ଣ୍ଣନା କରେ। ଏହା ଚୂଡ଼ାନ୍ତ ଗୋପନୀୟତା ବିଜ୍ଞପ୍ତି ନୁହେଁ, ଏବଂ ସମୀକ୍ଷା ଓ ଅନୁମୋଦନ ପୂର୍ବରୁ ଏହାକୁ ପ୍ରକୃତ ଲୋକଙ୍କ ପାଇଁ ବ୍ୟବହାର କରାଯିବ ନାହିଁ।",
    draftBannerStrong: "ପ୍ରାରମ୍ଭିକ — ଯୋଗ୍ୟ ଗୋପନୀୟତା ଓ ଆଇନଗତ ସମୀକ୍ଷା ଆବଶ୍ୟକ।",
    draftBannerWithContact: "ଜଣେ ଡାଟା-ସୁରକ୍ଷା ସମ୍ପର୍କୀୟ ବ୍ୟକ୍ତି ତଳେ ଲେଖା ହୋଇଛନ୍ତି।",
    draftBannerWithoutContact: "ଡାଟା ନିୟନ୍ତ୍ରକ, ସମ୍ପର୍କ, ଧାରଣ ସମୟସୀମା, ପ୍ରୋସେସର ଏବଂ ଆଇନଗତ ଭିତ୍ତି ଏପର୍ଯ୍ୟନ୍ତ ନିଶ୍ଚିତ ହୋଇନାହିଁ।",
    sections: [
      {
        heading: "ସେବା କେଉଁ ସୂଚନା ବ୍ୟବହାର କରିପାରେ",
        paragraphs: [{
          lead: null,
          body: "ଖାତା ପାଇଁ ଏକ ଇମେଲ୍ ଠିକଣା ଓ ନାମ ଆବଶ୍ୟକ। ସହଭାଗୀ ପଞ୍ଜୀକରଣରେ ସଂସ୍ଥାର ବିବରଣୀ, କାର୍ଯ୍ୟକାରୀ ସମ୍ପର୍କ, ସେବା କ୍ଷେତ୍ର ଏବଂ ସୀମିତ ଯାଞ୍ଚ ଦସ୍ତାବିଜ ରହିପାରେ। ବିତରଣ ରେକର୍ଡରେ ଦାନର ବିବରଣୀ, ରକ୍ଷଣାବେକ୍ଷଣ ଘଟଣା, ଘଟଣା ରିପୋର୍ଟ ଓ ରସିଦ ରହିପାରେ।",
        }],
      },
      {
        heading: "ଏହା କାହିଁକି ବ୍ୟବହୃତ ହୁଏ",
        paragraphs: [{
          lead: null,
          body: "ଖାତା ସୁରକ୍ଷା, ସଂସ୍ଥା ସମୀକ୍ଷା, ଦାନ ସମନ୍ୱୟ, ବିତରଣର ଅନୁସରଣ, ସହାୟତା ଓ ଘଟଣା ପ୍ରତିକ୍ରିୟା ପାଇଁ ସୂଚନା ବ୍ୟବହୃତ ହେବାର ଉଦ୍ଦେଶ୍ୟ ରହିଛି। ପ୍ରକୃତ ପରିଚାଳନା ମଡେଲ ପାଇଁ ଚୂଡ଼ାନ୍ତ ଉଦ୍ଦେଶ୍ୟ ଓ ଆଇନଗତ ଭିତ୍ତି ନିଶ୍ଚିତ କରିବାକୁ ପଡ଼ିବ।",
        }],
      },
      {
        heading: "ପ୍ରବେଶ ଓ ଧାରଣ",
        paragraphs: [
          {
            lead: null,
            body: "ପ୍ରବେଶ ଭୂମିକା ଓ ସଂସ୍ଥା ଅନୁସାରେ ସୀମିତ। ଯାଞ୍ଚ ଦସ୍ତାବିଜ ଗୋପନୀୟ ରହିବା ଉଚିତ। କେଉଁ ଧାରଣ ସମୟସୀମା ଲାଗୁ ହେବ ଏହା ଏପର୍ଯ୍ୟନ୍ତ ଏକ ଆଇନଗତ ନିଷ୍ପତ୍ତି ଯାହାକୁ କେହି ଅନୁମୋଦନ କରିନାହାନ୍ତି, ତେଣୁ ଏହି ପ୍ରାରମ୍ଭିକ ଲେଖା କେବଳ ସେହି କଥା କହେ ଯାହା ସଫ୍ଟୱେର୍ ଆଜି ପ୍ରକୃତରେ କାର୍ଯ୍ୟକାରୀ କରେ।",
          },
          {
            lead: "ଯାହା ଚାଲେ।",
            body: "ପ୍ରତି ରାତି ୦୩:୧୫ (ଭାରତୀୟ ସମୟ) ରେ ଏକ କାର୍ଯ୍ୟ ଚାଲେ ଏବଂ ପଢ଼ାଯାଇଥିବା ସୂଚନା ୯୦ ଦିନ ପରେ, ବ୍ୟବହୃତ ଏକବାର ସାଇନ୍-ଇନ୍ କୋଡ୍ ୧ ଦିନ ପରେ, ଅବଧି ଶେଷ ହୋଇଥିବା ବିତରଣ କୋଡ୍ ୩୦ ଦିନ ପରେ ଏବଂ ବିଫଳ ଇମେଲ୍ ୩୦ ଦିନ ପରେ ଡିଲିଟ୍ କରେ। ବନ୍ଦ ହୋଇଥିବା ସୁରକ୍ଷା ଘଟଣାର ମୁକ୍ତ ଲେଖା ଦୁଇ ବର୍ଷ ପରେ ଓ ଅଡିଟ୍ ରେକର୍ଡର ମୁକ୍ତ ଲେଖା ଛଅ ବର୍ଷ ପରେ ପରିଷ୍କାର କରେ, ରେକର୍ଡଟି ରଖି। ଯେକୌଣସି ସଫା କରିବା ପୂର୍ବରୁ ଜଣେ କର୍ମଚାରୀ ପ୍ରଭାବିତ ଧାଡ଼ିର ଠିକ୍ ସଂଖ୍ୟା ଦେଖିପାରନ୍ତି, ଯାହା ସେହି ସମାନ କୋଡ୍ ଦ୍ୱାରା ଆସେ, ଏବଂ ସେହି ପୂର୍ବାବଲୋକନ କିଛି ବଦଳାଏ ନାହିଁ।",
          },
          {
            lead: "ଯାହା ଏହାକୁ ଅଟକାଏ।",
            body: "ଜଣେ ବ୍ୟକ୍ତି, ଏକ ସଂସ୍ଥା, ଏକ ବିତରଣ କାର୍ଯ୍ୟ କିମ୍ବା ଏକ ଦାନ ଉପରେ ଆଇନଗତ ଧାରଣ ସବୁ ସମୟସୀମା ଉପରେ ରହେ। ଧାରଣରେ ଥିବା ରେକର୍ଡ କେବେ ଡିଲିଟ୍ ହୁଏ ନାହିଁ, ଧାରଣ ହଟାଯାଇପାରେ ନାହିଁ — କେବଳ ଜଣେ ନାମିତ କର୍ମଚାରୀ କାରଣ ସହ ମୁକ୍ତ କରିପାରନ୍ତି — ଏବଂ ପ୍ରତ୍ୟେକ ସଫା କରିବାରେ କେତେ ଧାଡ଼ି ରଖାଗଲା ତାହା ଦେଖାଯାଏ।",
          },
          {
            lead: "ଯାହା କେବେ ଡିଲିଟ୍ ହୁଏ ନାହିଁ।",
            body: "ଅଡିଟ୍ ରେକର୍ଡ ଓ ବିତରଣ ରସିଦ ଧାରଣ ଦ୍ୱାରା ଡିଲିଟ୍ ହୁଏ ନାହିଁ, କାରଣ ସେଗୁଡ଼ିକ ଖାଦ୍ୟ ସହ କଣ ଘଟିଲା ତାହାର ପ୍ରମାଣ। ଛଅ ବର୍ଷ ପରେ କେବଳ ଅଡିଟ୍ ରେକର୍ଡ ଭିତରର ମୁକ୍ତ ଲେଖା ଯାଏ; କିଏ କଣ, କେବେ ଓ କେଉଁ ରେକର୍ଡ ଉପରେ କଲା, ତାହା ରହେ।",
          },
        ],
      },
      {
        heading: "ଆପଣଙ୍କ ଅଧିକାର",
        paragraphs: [
          {
            lead: "ମିଟାଇବା।",
            body: "ଜଣେ ବ୍ୟକ୍ତି ମିଟାଇବା ମାଗିପାରନ୍ତି। ଏହା ପୂରଣ କଲେ ସେମାନଙ୍କ ନାମ, ଇମେଲ୍ ଓ ପ୍ରମାଣପତ୍ର ଅତିକ୍ରମ କରାଯାଏ ଏବଂ ସେସନ୍ ବନ୍ଦ ହୁଏ, ମାତ୍ର ରସିଦ ଓ ଅଡିଟ୍ ରେକର୍ଡ ରହେ ଯାହା ଖାଦ୍ୟ ପାଇଁ ଉତ୍ତର ଦିଏ। ମିଟାଇବା ନିଜେ ଅଡିଟ୍ ରେକର୍ଡରେ ଲେଖା ହୁଏ।",
          },
          {
            lead: "ଆପଣଙ୍କ ତଥ୍ୟ ପାଇବା।",
            body: "ଯେକୌଣସି ସାଇନ୍-ଇନ୍ ବ୍ୟକ୍ତି ନିଜ ପ୍ରୋଫାଇଲ୍ ପୃଷ୍ଠାରୁ ଏକ ଫାଇଲ୍ ତିଆରି କରିପାରନ୍ତି ଯେଉଁଥିରେ ଏହି ସେବା ସେମାନଙ୍କ ଖାତା ବିଷୟରେ ରଖିଥିବା ସବୁକିଛି ରହେ — ପ୍ରୋଫାଇଲ୍, ସଦସ୍ୟତା, ସୂଚନା, ଦାନ, ରସିଦ, ରକ୍ଷଣାବେକ୍ଷଣ ଘଟଣା, ସହାୟତା ଓ ଗୋପନୀୟତା ଅନୁରୋଧ, ଏବଂ ଚାଲିଥିବା ଧାରଣ କାର୍ଯ୍ୟ। ଡାଉନଲୋଡ୍ ଅଡିଟ୍ ରେକର୍ଡରେ ଏକ ପ୍ରକାଶ ଭାବରେ ଲେଖା ହୁଏ।",
          },
          {
            lead: "କିଛି ସଂଶୋଧନ କରିବା।",
            body: "ଆପଣ ନିଜର ପ୍ରଦର୍ଶିତ ନାମ ବଦଳାଇପାରିବେ, ଏବଂ ପରିବର୍ତ୍ତନ ଲେଖା ହୁଏ। ଆପଣଙ୍କ ଇମେଲ୍ ଠିକଣା, ସହଭାଗୀଙ୍କ ଫୋନ୍ ନମ୍ବର, ସଂସ୍ଥାର ପଞ୍ଜୀକୃତ ନାମ ଓ ଯାଞ୍ଚ ସ୍ଥିତି ଏପରି ରେକର୍ଡ ଯାହା ଅନ୍ୟମାନେ ବ୍ୟବହାର କରନ୍ତି, ତେଣୁ ସେଗୁଡ଼ିକ ନୀରବ ସଂଶୋଧନ ପରିବର୍ତ୍ତେ ସମୀକ୍ଷିତ ଅନୁରୋଧ ମାଧ୍ୟମରେ ଯାଏ।",
          },
          {
            lead: "ମିଟାଇବା ମାଗିବା।",
            body: "ମିଟାଇବା ଏକ ବଟନ୍ ନୁହେଁ, ଏକ ସମୀକ୍ଷିତ ଅନୁରୋଧ, କାରଣ ଏହା ଆପଣଙ୍କ ସାଇନ୍-ଇନ୍ ପଦ୍ଧତି ବନ୍ଦ କରେ ଓ ଫେରାଯାଇପାରେ ନାହିଁ। ଅନୁମୋଦିତ ହେଲେ, ଅନୁରୋଧ ବନ୍ଦ କରୁଥିବା ସେହି ଏକ ପଦକ୍ଷେପରେ ଆପଣଙ୍କ ନାମ, ଇମେଲ୍ ଓ ପ୍ରମାଣପତ୍ର ଅତିକ୍ରମ କରାଯାଏ ଓ ସେସନ୍ ନଷ୍ଟ ହୁଏ — ଦୁଇଟି ଅଲଗା ହୋଇପାରେ ନାହିଁ। ଆପଣଙ୍କ ରସିଦ ଓ ଅଡିଟ୍ ରେକର୍ଡ ରହେ, କାରଣ ସେଗୁଡ଼ିକ ଖାଦ୍ୟ ସହ କଣ ଘଟିଲା ତାହା ପାଇଁ ଉତ୍ତର ଦିଏ।",
          },
        ],
      },
      {
        heading: "ଆମେ କେତେ ସମୟ ନେଉ",
        paragraphs: [{
          lead: null,
          body: "କୌଣସି ସମୟସୀମା ଏପର୍ଯ୍ୟନ୍ତ ଲେଖା ହୋଇନାହିଁ, ତେଣୁ ଏଠାରେ କୌଣସି ପ୍ରତିଶ୍ରୁତି ନାହିଁ। କେହି ଏହାକୁ ଗ୍ରହଣ କରି ତାହା ପାଇଁ ଉତ୍ତର ଦାୟୀ ହେଲେ ହିଁ ଏଠାରେ ଏକ ସଂଖ୍ୟା ଦେଖାଯିବ।",
        }],
      },
      {
        heading: "ଯାହା ଏପର୍ଯ୍ୟନ୍ତ ନିଶ୍ଚିତ ନୁହେଁ",
        paragraphs: [{
          lead: null,
          body: "ଉପରର ଧାରଣ ସମୟସୀମା ଡିଫଲ୍ଟ, ଅନୁମୋଦିତ ନୀତି ନୁହେଁ, ଏବଂ ପ୍ରକୃତ କାର୍ଯ୍ୟାନୁଷ୍ଠାନ ପୂର୍ବରୁ ସମ୍ପୂର୍ଣ୍ଣ ତାଲିକା ପାଇଁ ଯୋଗ୍ୟ ଗୋପନୀୟତା ଓ ଆଇନଗତ ସମୀକ୍ଷା ଆବଶ୍ୟକ। ଇମେଲ୍ ଠିକଣା କିମ୍ବା ସହଭାଗୀ ସମ୍ପର୍କର ସଂଶୋଧନ ଜଣେ ମନୁଷ୍ୟ ଦ୍ୱାରା ହେଉଛି, ସ୍ୱଚାଳିତ ଭାବରେ ନୁହେଁ। ସଂଶୋଧନ ଓ ଅଭିଯୋଗର ଆଗକୁ ନେବାର ସ୍ୱତନ୍ତ୍ର ମାର୍ଗ ନାହିଁ — କାର୍ଯ୍ୟପରିଚାଳନା ସ୍କ୍ରିନ୍ ସମୟ ଅତିକ୍ରମ ଦେଖାଏ, ସେତିକି।",
        }],
      },
    ],
    contactHeading: "ସମ୍ପର୍କ ଓ ଅଧିକାର",
    noContact: "କୌଣସି ସାର୍ବଜନୀନ ଗୋପନୀୟତା ସମ୍ପର୍କ ଲେଖା ହୋଇନାହିଁ। ଏହି ପ୍ରାରମ୍ଭିକ ସାଇଟ୍ ମାଧ୍ୟମରେ ସମ୍ବେଦନଶୀଳ ବ୍ୟକ୍ତିଗତ ତଥ୍ୟ ଦିଅନ୍ତୁ ନାହିଁ। ଆରମ୍ଭ ପୂର୍ବରୁ ସମୀକ୍ଷିତ ବିଜ୍ଞପ୍ତି ଓ ନାମିତ ଅଭିଯୋଗ ମାର୍ଗ ଆବଶ୍ୟକ।",
    controller: (name, jurisdiction) => `ନିୟନ୍ତ୍ରକ: ${name}${jurisdiction ? `, ${jurisdiction}` : ""}।`,
  },

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
 * Kept as a function rather than a substitution because Odia puts the number and the clause in a
 * different order from English. A `{hours}` slot would produce word salad in one of the two.
 */
export function responseWindowParagraph(
  locale: "or" | "en",
  window: { hours: number | null; staffedBy: string | null },
): string {
  if (window.hours === null) {
    return locale === "or"
      ? "କୌଣସି ସମୟସୀମା ଲେଖା ହୋଇନାହିଁ, ତେଣୁ ଏଠାରେ କୌଣସି ପ୍ରତିଶ୍ରୁତି ନାହିଁ।"
      : "No response window has been recorded yet, so none is promised here.";
  }
  if (locale === "or") {
    const who = window.staffedBy ? `${window.staffedBy} ସେହି ସମୟସୀମା ପାଇଁ ଉତ୍ତର ଦାୟୀ।` : "";
    return `ଆମେ ଗୋପନୀୟତା ଓ ସହାୟତା ଅନୁରୋଧର ଉତ୍ତର ${window.hours} ଘଣ୍ଟା ଭିତରେ ଦେଉ। ${who} ଏହି ସଂଖ୍ୟା କାର୍ଯ୍ୟପରିଚାଳନା ରେଜିଷ୍ଟରରେ ଲେଖା ହୋଇଛି, ଏବଂ ସେହି ସମୟ ଅତିକ୍ରମ କରୁଥିବା ଅନୁରୋଧ କାର୍ଯ୍ୟପରିଚାଳନା ସ୍କ୍ରିନରେ ବିଳମ୍ବିତ ଭାବରେ ଦେଖାଯାଏ।`;
  }
  const who = window.staffedBy ? ` — ${window.staffedBy} is on the other end of that window` : "";
  return `We answer privacy and support requests within ${window.hours} hours${who}. That number is the one recorded on the operations register, and anything past it is counted as overdue, so a request that slips the window shows up rather than ageing quietly.`;
}
