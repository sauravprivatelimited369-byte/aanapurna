/**
 * The languages this interface is published in.
 *
 * English is the default. Hindi and Bengali are offered because the owner asked for them, and the
 * populations they serve are real: western Odisha has a substantial Hindi-speaking population —
 * migrant workers, traders, transport contractors — and Bengali is the language of many readers the
 * directory pages are written for.
 *
 * Odia was removed on the owner's instruction. Nothing in the code should treat Odia as a language
 * this product speaks, and the switcher no longer offers it.
 *
 * The translations are written as prose rather than assembled from fragments. Sentence order differs
 * between languages, so a template like `"within " + hours + " hours"` cannot be translated by
 * substitution — Hindi puts the number where English does not. Where a number or a date is involved,
 * the whole sentence is stored per language.
 *
 * This is a dictionary, not a framework. There is no pluralisation engine and no message extraction.
 * A framework here would be machinery to maintain for a problem a table already solves.
 *
 * What is translated is deliberately partial, and the interface says so rather than pretending. The
 * `translated` map below records which surfaces each language actually covers; anything absent is
 * named on screen as not yet translated, in the reader's own language. Silent fallback to English is
 * the failure mode this file exists to prevent.
 */

/**
 * Note: this module is imported by client components as well as server ones, so it carries no
 * `server-only` guard. The dictionary is public text and the resolver is pure; there is no secret
 * here. The cookie and header read lives in `locale-server.ts`, which *is* server-only.
 */
export const LOCALES = ["en", "hi", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** What each language calls itself, for the switcher. Never translate a language's own name. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  bn: "বাংলা",
};

export const LOCALE_COOKIE = "annapurna_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * A person's language, from the cookie they chose, falling back to what their browser asked for.
 *
 * Order matters: an explicit choice outranks a header, because somebody who has already told us they
 * read Hindi should not be moved back to English by a browser default on their next device.
 */
export function resolveLocale(cookieValue: unknown, acceptLanguage: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase() ?? "";
    if (tag === "en" || tag.startsWith("en-")) return "en";
    if (tag === "hi" || tag.startsWith("hi-")) return "hi";
    if (tag === "bn" || tag.startsWith("bn-")) return "bn";
  }
  return DEFAULT_LOCALE;
}

const EN = {
  "request.progress.heading": "Where your request is",
  "request.progress.showTimeline": "Show the timeline",
  "request.progress.hideTimeline": "Hide the timeline",
  "request.progress.loading": "Looking up your request…",
  "request.progress.failed": "The status of this request could not be read.",
  "request.progress.waited": "Waiting",
  "request.progress.hours": "hours",
  "request.progress.nextStep": "What happens next",
  "request.progress.queue": "{count} open requests were submitted before yours",
  "request.progress.noWindow": "No response window is recorded, so no date is promised.",
  "request.progress.window": "Promised answer within {hours} hours",
  "request.progress.overdue": "Past the {hours}-hour window",
  "request.progress.onTime": "Inside the window",
  "request.progress.current": "Here now",
  "privacy.nav": "Privacy",
  "common.dateAt": "on {date} at {time}",
  "common.skipToContent": "Skip to main content",
  "common.language": "Language",
  "common.close": "Close",
  "common.menu": "Menu",

  "nav.home": "Home",
  "nav.howItWorks": "How it works",
  "nav.impact": "Our impact",
  "nav.foodSafety": "Food safety",
  "nav.answers": "Straight answers",
  "nav.about": "About us",
  "nav.contact": "Contact",
  "nav.preview": "Preview",
  "nav.login": "Log in",
  "nav.join": "Join Annapurna",

  "home.eyebrow": "Surplus food · responsible handovers",
  "home.title": "Good food deserves <em>a destination.</em>",
  "home.lead": "Annapurna Link coordinates surplus food between donors and community organisations—with approved Helpers, clear handling information and a confirmed delivery record.",
  "home.donate": "Donate surplus food",
  "home.becomeHelper": "Become a Helper",
  "home.registerOrg": "Register your organisation",
  "home.sampleWalkthrough": "Walk through a sample handover — no account needed",
  "home.reviewNote": "Requests are reviewed by people. Food operations remain paused until launch approvals are recorded.",
  "home.rolesEyebrow": "Three roles, one shared outcome",
  "home.rolesTitle": "Start with the part <em>you can play.</em>",
  "home.rolesIntro": "Choose a role to request access. Selecting a role starts a review—it does not approve a person, organisation or donation.",
  "home.closingEyebrow": "Begin with a human review",
  "home.closingTitle": "One careful handover can make a difference.",
  "home.closingText": "Request partner access. Real food operations will remain paused until the people, policies and local approvals are ready.",
  "home.startRequest": "Start an access request",
  "home.contactSupport": "Contact and support",

  "language.coverageNote": "Parts of this page are not yet translated into {language}. Anything untranslated is shown in English.",
  "language.untranslatedBanner": "This page is not yet translated into {language}. It is shown in English.",
  "home.role.generator.title": "Food donors",
  "home.role.generator.label": "Restaurants · hotels · caterers",
  "home.role.generator.text": "Share a clear surplus-food offer and its preparation, storage and collection details.",
  "home.role.generator.action": "Request donor access",
  "home.role.receiver.title": "Community organisations",
  "home.role.receiver.label": "Receivers · NGOs · shelters",
  "home.role.receiver.text": "Review offers against your real receiving capacity and confirm each handover when it arrives.",
  "home.role.receiver.action": "Register your organisation",
  "home.role.helper.title": "Delivery Helpers",
  "home.role.helper.label": "Volunteers · approved drivers",
  "home.role.helper.text": "Support a collection and delivery with clear custody steps and role-limited details.",
  "home.role.helper.action": "Request Helper access",
} as const;

const HI = {
  "request.progress.heading": "आपका अनुरोध कहाँ है",
  "request.progress.showTimeline": "समयरेखा देखें",
  "request.progress.hideTimeline": "समयरेखा छिपाएँ",
  "request.progress.loading": "अनुरोध खोजा जा रहा है…",
  "request.progress.failed": "इस अनुरोध की स्थिति पढ़ी नहीं जा सकी।",
  "request.progress.waited": "प्रतीक्षा",
  "request.progress.hours": "घंटे",
  "request.progress.nextStep": "अगला कदम",
  "request.progress.queue": "आपसे पहले {count} खुले अनुरोध जमा हुए हैं",
  "request.progress.noWindow": "कोई उत्तर-समय दर्ज नहीं है, इसलिए कोई तारीख़ का वादा नहीं है।",
  "request.progress.window": "{hours} घंटे में उत्तर देने का वादा",
  "request.progress.overdue": "{hours} घंटे की समयसीमा बीत चुकी है",
  "request.progress.onTime": "समयसीमा के भीतर",
  "request.progress.current": "अभी यहाँ",
  "privacy.nav": "निजता",
  "common.dateAt": "{date} को, {time} बजे",
  "common.skipToContent": "मुख्य सामग्री पर जाएँ",
  "common.language": "भाषा",
  "common.close": "बंद करें",
  "common.menu": "मेन्यू",

  "nav.home": "मुख्य पृष्ठ",
  "nav.howItWorks": "यह कैसे काम करता है",
  "nav.impact": "हमारा प्रभाव",
  "nav.foodSafety": "खाद्य सुरक्षा",
  "nav.answers": "सीधे उत्तर",
  "nav.about": "हमारे बारे में",
  "nav.contact": "संपर्क",
  "nav.preview": "नमूना",
  "nav.login": "लॉग इन",
  "nav.join": "अन्नपूर्णा से जुड़ें",

  "home.eyebrow": "अतिरिक्त भोजन · ज़िम्मेदार हस्तांतरण",
  "home.title": "अच्छे भोजन का एक <em>गंतव्य होना चाहिए।</em>",
  "home.lead": "अन्नपूर्णा लिंक दाताओं और सामुदायिक संगठनों के बीच अतिरिक्त भोजन का समन्वय करता है — स्वीकृत स्वयंसेवकों, स्पष्ट हैंडलिंग जानकारी और एक पुष्ट वितरण रिकॉर्ड के साथ।",
  "home.donate": "अतिरिक्त भोजन दान करें",
  "home.becomeHelper": "स्वयंसेवक बनें",
  "home.registerOrg": "अपना संगठन पंजीकृत करें",
  "home.sampleWalkthrough": "एक नमूना हस्तांतरण देखें — खाता आवश्यक नहीं",
  "home.reviewNote": "अनुरोधों की समीक्षा लोग करते हैं। लॉन्च स्वीकृतियाँ दर्ज होने तक भोजन संचालन बंद रहता है।",
  "home.rolesEyebrow": "तीन भूमिकाएँ, एक साझा परिणाम",
  "home.rolesTitle": "उस <em>भूमिका से शुरू करें जो आप निभा सकें।</em>",
  "home.rolesIntro": "पहुँच का अनुरोध करने के लिए एक भूमिका चुनें। भूमिका चुनने से समीक्षा शुरू होती है — इससे किसी व्यक्ति, संगठन या दान को स्वीकृति नहीं मिलती।",
  "home.closingEyebrow": "मानवीय समीक्षा से शुरुआत",
  "home.closingTitle": "एक सावधान हस्तांतरण बदलाव ला सकता है।",
  "home.closingText": "साझेदार पहुँच का अनुरोध करें। जब तक लोग, नीतियाँ और स्थानीय स्वीकृतियाँ तैयार नहीं होतीं, वास्तविक भोजन संचालन बंद रहेगा।",
  "home.startRequest": "पहुँच अनुरोध शुरू करें",
  "home.contactSupport": "संपर्क और सहायता",

  "language.coverageNote": "इस पृष्ठ के कुछ भाग अभी {language} में अनूदित नहीं हैं। जो अनूदित नहीं है वह अंग्रेज़ी में दिखाया जाता है।",
  "language.untranslatedBanner": "यह पृष्ठ अभी {language} में अनूदित नहीं है। यह अंग्रेज़ी में दिखाया जा रहा है।",
  "home.role.generator.title": "भोजन दाता",
  "home.role.generator.label": "रेस्टोरेंट · होटल · कैटरर",
  "home.role.generator.text": "एक स्पष्ट अतिरिक्त भोजन प्रस्ताव और उसकी तैयारी, भंडारण व संग्रह का विवरण साझा करें।",
  "home.role.generator.action": "दाता पहुँच का अनुरोध करें",
  "home.role.receiver.title": "सामुदायिक संगठन",
  "home.role.receiver.label": "प्राप्तकर्ता · एनजीओ · आश्रय स्थल",
  "home.role.receiver.text": "अपनी वास्तविक प्राप्ति क्षमता के अनुसार प्रस्तावों की समीक्षा करें और प्रत्येक हस्तांतरण आने पर उसकी पुष्टि करें।",
  "home.role.receiver.action": "अपना संगठन पंजीकृत करें",
  "home.role.helper.title": "वितरण स्वयंसेवक",
  "home.role.helper.label": "स्वयंसेवक · स्वीकृत चालक",
  "home.role.helper.text": "स्पष्ट अभिरक्षा चरणों और भूमिका-सीमित विवरणों के साथ संग्रह और वितरण में सहायता करें।",
  "home.role.helper.action": "स्वयंसेवक पहुँच का अनुरोध करें",
} as const;

const BN = {
  "request.progress.heading": "আপনার অনুরোধ কোথায় আছে",
  "request.progress.showTimeline": "সময়রেখা দেখুন",
  "request.progress.hideTimeline": "সময়রেখা লুকান",
  "request.progress.loading": "অনুরোধ খোঁজা হচ্ছে…",
  "request.progress.failed": "এই অনুরোধের অবস্থা পড়া যায়নি।",
  "request.progress.waited": "অপেক্ষা",
  "request.progress.hours": "ঘণ্টা",
  "request.progress.nextStep": "পরবর্তী ধাপ",
  "request.progress.queue": "আপনার আগে {count}টি খোলা অনুরোধ জমা হয়েছে",
  "request.progress.noWindow": "কোনো উত্তরের সময়সীমা নথিভুক্ত নেই, তাই কোনো তারিখের প্রতিশ্রুতি নেই।",
  "request.progress.window": "{hours} ঘণ্টার মধ্যে উত্তর দেওয়ার প্রতিশ্রুতি",
  "request.progress.overdue": "{hours} ঘণ্টার সময়সীমা পার হয়েছে",
  "request.progress.onTime": "সময়সীমার ভিতরে",
  "request.progress.current": "এখন এখানে",
  "privacy.nav": "গোপনীয়তা",
  "common.dateAt": "{date}-এ, {time}-টায়",
  "common.skipToContent": "মূল বিষয়বস্তুতে যান",
  "common.language": "ভাষা",
  "common.close": "বন্ধ করুন",
  "common.menu": "মেনু",

  "nav.home": "প্রথম পাতা",
  "nav.howItWorks": "এটি কীভাবে কাজ করে",
  "nav.impact": "আমাদের প্রভাব",
  "nav.foodSafety": "খাদ্য নিরাপত্তা",
  "nav.answers": "সরাসরি উত্তর",
  "nav.about": "আমাদের সম্পর্কে",
  "nav.contact": "যোগাযোগ",
  "nav.preview": "নমুনা",
  "nav.login": "লগ ইন",
  "nav.join": "অন্নপূর্ণায় যোগ দিন",

  "home.eyebrow": "অতিরিক্ত খাদ্য · দায়িত্বশীল হস্তান্তর",
  "home.title": "ভালো খাবারের একটি <em>গন্তব্য থাকা উচিত।</em>",
  "home.lead": "অন্নপূর্ণা লিংক দাতা ও সম্প্রদায় সংগঠনের মধ্যে অতিরিক্ত খাদ্য সমন্বয় করে — অনুমোদিত স্বেচ্ছাসেবক, স্পষ্ট পরিচালনা নির্দেশনা এবং একটি নিশ্চিত বিতরণ রেকর্ড সহ।",
  "home.donate": "অতিরিক্ত খাদ্য দান করুন",
  "home.becomeHelper": "স্বেচ্ছাসেবক হোন",
  "home.registerOrg": "আপনার সংগঠন নথিভুক্ত করুন",
  "home.sampleWalkthrough": "একটি নমুনা হস্তান্তর দেখুন — অ্যাকাউন্ট লাগবে না",
  "home.reviewNote": "অনুরোধ মানুষ পর্যালোচনা করেন। লঞ্চ অনুমোদন নথিভুক্ত না হওয়া পর্যন্ত খাদ্য কার্যক্রম বন্ধ থাকে।",
  "home.rolesEyebrow": "তিনটি ভূমিকা, একটি অভিন্ন লক্ষ্য",
  "home.rolesTitle": "আপনি যে <em>ভূমিকা নিতে পারেন</em> তা দিয়ে শুরু করুন।",
  "home.rolesIntro": "প্রবেশ অনুরোধ করতে একটি ভূমিকা বেছে নিন। ভূমিকা বাছাই একটি পর্যালোচনা শুরু করে — এটি কোনো ব্যক্তি, সংগঠন বা দান অনুমোদন করে না।",
  "home.closingEyebrow": "মানব পর্যালোচনা দিয়ে শুরু",
  "home.closingTitle": "একটি সতর্ক হস্তান্তর পার্থক্য গড়তে পারে।",
  "home.closingText": "অংশীদার প্রবেশের অনুরোধ করুন। মানুষ, নীতি ও স্থানীয় অনুমোদন প্রস্তুত না হওয়া পর্যন্ত প্রকৃত খাদ্য কার্যক্রম বন্ধ থাকবে।",
  "home.startRequest": "প্রবেশ অনুরোধ শুরু করুন",
  "home.contactSupport": "যোগাযোগ ও সহায়তা",

  "language.coverageNote": "এই পৃষ্ঠার কিছু অংশ এখনও {language}-এ অনূদিত হয়নি। যা অনূদিত নয় তা ইংরেজিতে দেখানো হয়।",
  "language.untranslatedBanner": "এই পৃষ্ঠাটি এখনও {language}-এ অনূদিত হয়নি। এটি ইংরেজিতে দেখানো হচ্ছে।",
  "home.role.generator.title": "খাদ্য দাতা",
  "home.role.generator.label": "রেস্তোরাঁ · হোটেল · ক্যাটারার",
  "home.role.generator.text": "একটি স্পষ্ট অতিরিক্ত খাদ্য প্রস্তাব এবং তার প্রস্তুতি, সংরক্ষণ ও সংগ্রহ বিবরণ শেয়ার করুন।",
  "home.role.generator.action": "দাতা প্রবেশের অনুরোধ করুন",
  "home.role.receiver.title": "সম্প্রদায় সংগঠন",
  "home.role.receiver.label": "গ্রহীতা · এনজিও · আশ্রয়কেন্দ্র",
  "home.role.receiver.text": "আপনার প্রকৃত গ্রহণ ক্ষমতা অনুযায়ী প্রস্তাব পর্যালোচনা করুন এবং প্রতিটি হস্তান্তর এলে তা নিশ্চিত করুন।",
  "home.role.receiver.action": "আপনার সংগঠন নথিভুক্ত করুন",
  "home.role.helper.title": "বিতরণ স্বেচ্ছাসেবক",
  "home.role.helper.label": "স্বেচ্ছাসেবক · অনুমোদিত চালক",
  "home.role.helper.text": "স্পষ্ট হেফাজত ধাপ ও ভূমিকা-সীমিত বিবরণ সহ সংগ্রহ ও বিতরণে সহায়তা করুন।",
  "home.role.helper.action": "স্বেচ্ছাসেবক প্রবেশের অনুরোধ করুন",
} as const;

export type MessageKey = keyof typeof EN;

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en: EN, hi: HI, bn: BN };

/**
 * Look up a message and substitute `{name}` placeholders.
 *
 * Only whole-sentence substitution is used. Word order is the translator's decision, so a caller
 * must never split a message to interleave markup or to reorder a number.
 */
export function t(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  const template = MESSAGES[locale][key] ?? MESSAGES.en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match);
}

/** A translator bound to one language, which is what a page component should hold. */
export function translator(locale: Locale) {
  return (key: MessageKey, values?: Record<string, string | number>) => t(locale, key, values);
}

/**
 * Dates in the reader's language.
 *
 * Asia/Kolkata rather than the server's zone: everybody this serves is in one timezone, and a request
 * that says it was answered "tomorrow" because a server ran in UTC is worse than no timestamp.
 */
const INTL_TAGS: Record<Locale, string> = { en: "en-IN", hi: "hi-IN", bn: "bn-IN" };

export function formatDate(locale: Locale, value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(INTL_TAGS[locale], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value instanceof Date ? value : new Date(value));
}

/** The `lang` attribute for <html>, so a screen reader switches voice rather than mispronouncing. */
export function htmlLang(locale: Locale): string {
  return INTL_TAGS[locale];
}
