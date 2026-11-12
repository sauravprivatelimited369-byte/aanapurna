import { ArrowRight, Building2, Sparkles, UtensilsCrossed } from "lucide-react";

export function FoodArt() {
  return (
    <div className="food-art" role="img" aria-label="Original illustration of surplus food moving from a donor kitchen toward a community receiver">
      <div className="art-orbit art-orbit--one" aria-hidden="true" />
      <div className="art-orbit art-orbit--two" aria-hidden="true" />
      <svg className="art-route" viewBox="0 0 540 480" aria-hidden="true">
        <path d="M60 310C110 308 104 195 186 200s92 106 166 77 66-132 128-133" fill="none" stroke="rgba(255,183,3,.36)" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="2" />
        <circle cx="60" cy="310" r="5" fill="#ffb703" />
        <circle cx="480" cy="144" r="5" fill="#ffb703" />
        <circle cx="60" cy="310" r="12" fill="none" stroke="rgba(255,183,3,.42)" />
        <circle cx="480" cy="144" r="12" fill="none" stroke="rgba(255,183,3,.42)" />
      </svg>
      <div className="art-label art-label--pickup"><span className="art-dot" aria-hidden="true" /><UtensilsCrossed size={15} aria-hidden="true" /> Donor kitchen</div>
      <div className="art-label art-label--arrival"><span className="art-dot art-dot--green" aria-hidden="true" /><Building2 size={15} aria-hidden="true" /> Community receiver</div>
      <div className="art-bowl" aria-hidden="true">
        <svg viewBox="0 0 330 260">
          <defs>
            <linearGradient id="bowl" x1=".15" x2=".82" y1="0" y2="1"><stop stopColor="#f7c85b" /><stop offset="1" stopColor="#df8c2e" /></linearGradient>
            <linearGradient id="leaf" x1=".2" x2=".9" y1=".1" y2=".9"><stop stopColor="#8cb96f" /><stop offset="1" stopColor="#3f7553" /></linearGradient>
            <linearGradient id="rice" x1=".1" x2="1" y1=".2" y2=".9"><stop stopColor="#fff4d4" /><stop offset="1" stopColor="#ead9aa" /></linearGradient>
          </defs>
          <ellipse cx="164" cy="207" rx="122" ry="21" fill="rgba(0,0,0,.3)" />
          <path d="M49 125c4 58 49 103 115 103s111-45 116-103H49Z" fill="url(#bowl)" />
          <ellipse cx="164" cy="126" rx="116" ry="57" fill="#443021" />
          <ellipse cx="164" cy="122" rx="107" ry="48" fill="#f3d68f" />
          <path d="M77 120c15-21 38-34 64-36 13 7 21 19 22 34-13 19-35 31-61 32-12-7-21-17-25-30Z" fill="url(#leaf)" />
          <path d="M161 91c21-15 46-19 67-12 12 10 19 24 18 39-14 16-37 25-61 22-14-9-23-26-24-49Z" fill="#e5794f" />
          <path d="M113 100c14-13 32-20 50-19 9 13 12 29 6 44-16 14-37 17-57 9-7-10-7-22 1-34Z" fill="url(#rice)" />
          <path d="M190 138c5-18 20-31 39-35 13 6 22 18 25 33-11 14-27 22-45 20-10-3-17-9-19-18Z" fill="#edbd4a" />
          <path d="M104 153c5-13 16-22 30-25 11 4 18 13 20 24-8 11-20 17-33 16-8-3-14-8-17-15Z" fill="#f3f0df" />
          <path d="M74 123c19 2 33 11 41 25m15-61c9 11 12 24 8 39m54-35c-9 12-13 23-11 35m51-22c-13 2-22 10-29 21" fill="none" stroke="rgba(37,68,48,.68)" strokeLinecap="round" strokeWidth="3" />
          <path d="M97 111c5-14 17-25 32-28 6 6 9 14 8 22-10 10-24 15-38 13-2-2-3-4-2-7Z" fill="#82ad68" />
          <circle cx="214" cy="108" r="5" fill="#fff3c6" /><circle cx="232" cy="128" r="4" fill="#fff3c6" /><circle cx="188" cy="112" r="3" fill="#fff3c6" />
          <path d="M71 138c34 20 153 23 197-3" fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="2" />
          <path d="M95 207c32 17 112 20 147 1" fill="none" stroke="rgba(119,66,25,.26)" strokeLinecap="round" strokeWidth="3" />
        </svg>
        <span className="art-sticker">Good food,<br />shared with care</span>
      </div>
      <div className="art-note"><span className="art-note-icon"><ArrowRight size={18} aria-hidden="true" /></span><span><strong>Every handover, recorded</strong><small>Only the Receiver confirms delivery.</small></span></div>
      <Sparkles className="art-spark art-spark--one" size={19} aria-hidden="true" />
      <Sparkles className="art-spark art-spark--two" size={16} aria-hidden="true" />
    </div>
  );
}
