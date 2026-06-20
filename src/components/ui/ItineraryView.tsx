'use client';

import { Calendar, Clock, Compass, Package } from 'lucide-react';

interface SubItem {
  time?: string;
  text: string;
}
interface ItineraryDay {
  label: string;
  detail: string;
  subItems: SubItem[];
}
interface ParsedPlan {
  overview?: string;
  days: ItineraryDay[];
  carry?: string;
  extras: { label: string; text: string }[];
  // True when the plan had no recognisable structure (just free text).
  raw?: string;
}

// Matches a leading **Label:** with optional trailing content on the same line.
const BOLD_LABEL = /^\*\*\s*(.+?)\s*:\s*\*\*\s*(.*)$/;
// Strips a leading list marker (*, -, •) and returns the indentation depth.
const stripBullet = (line: string) => {
  const m = line.match(/^(\s*)([*\-•])\s+(.*)$/);
  if (m) return { indent: m[1].length, hadBullet: true, text: m[3] };
  return { indent: line.match(/^(\s*)/)?.[1].length ?? 0, hadBullet: false, text: line.trim() };
};

function parsePlan(plan: string): ParsedPlan {
  const result: ParsedPlan = { days: [], extras: [] };
  const lines = plan.split('\n').filter((l) => l.trim().length > 0);

  // No markdown structure at all → render as-is.
  if (!plan.includes('**')) {
    result.raw = plan.trim();
    return result;
  }

  let section: 'overview' | 'itinerary' | 'carry' | 'extra' | null = null;
  let currentDay: ItineraryDay | null = null;

  for (const rawLine of lines) {
    const { hadBullet, text } = stripBullet(rawLine);
    const bold = text.match(BOLD_LABEL);

    // Top-level section header (a bold label that isn't a bulleted item).
    if (bold && !hadBullet) {
      const key = bold[1].toLowerCase();
      const content = bold[2].trim();
      if (key.startsWith('overview')) {
        section = 'overview';
        result.overview = content;
      } else if (key.startsWith('itinerary') || key.startsWith('route') || key.startsWith('plan')) {
        section = 'itinerary';
      } else if (key.includes('carry') || key.includes('bring') || key.includes('gear') || key.includes('pack')) {
        section = 'carry';
        result.carry = content;
      } else {
        section = 'extra';
        result.extras.push({ label: bold[1], text: content });
      }
      continue;
    }

    if (section === 'itinerary') {
      if (bold && /^day\b|^day\s*\d/i.test(bold[1])) {
        currentDay = { label: bold[1], detail: bold[2].trim(), subItems: [] };
        result.days.push(currentDay);
        continue;
      }
      if (!currentDay) {
        // A bullet under Itinerary that isn't a day → make a generic day node.
        currentDay = { label: '', detail: '', subItems: [] };
        result.days.push(currentDay);
      }
      if (bold) {
        currentDay.subItems.push({ time: bold[1], text: bold[2].trim() });
      } else {
        currentDay.subItems.push({ text });
      }
      continue;
    }

    // Continuation lines for the active simple section.
    if (section === 'overview') {
      result.overview = `${result.overview ?? ''} ${text}`.trim();
    } else if (section === 'carry') {
      result.carry = `${result.carry ?? ''} ${text}`.trim();
    } else if (section === 'extra' && result.extras.length) {
      const last = result.extras[result.extras.length - 1];
      last.text = `${last.text} ${text}`.trim();
    }
  }

  return result;
}

export default function ItineraryView({ plan }: { plan: string }) {
  const parsed = parsePlan(plan);

  if (parsed.raw) {
    return (
      <div className="relative border-l-2 border-blue-500/20 ml-4 pl-8 py-2">
        <div className="absolute top-0 -left-[9px] w-4 h-4 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
        <div className="bg-white/5 p-8 rounded-3xl border border-white/10 backdrop-blur-sm">
          <p className="text-slate-300 leading-relaxed text-lg">{parsed.raw}</p>
        </div>
      </div>
    );
  }

  const carryItems = parsed.carry
    ? parsed.carry.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return (
    <div className="space-y-8">
      {parsed.overview && (
        <div className="flex gap-4 bg-white/5 p-6 rounded-3xl border border-white/10">
          <Compass className="w-6 h-6 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-blue-300 mb-1">Overview</h3>
            <p className="text-slate-300 leading-relaxed">{parsed.overview}</p>
          </div>
        </div>
      )}

      {parsed.days.length > 0 && (
        <div className="relative border-l-2 border-blue-500/20 ml-3 pl-8 space-y-8">
          {parsed.days.map((day, i) => (
            <div key={i} className="relative">
              <div className="absolute -left-[41px] top-1 flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold shadow-[0_0_15px_rgba(59,130,246,0.4)]">
                {i + 1}
              </div>
              <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                {day.label && (
                  <h3 className="flex items-center gap-2 text-lg font-bold text-white mb-2">
                    <Calendar className="w-4 h-4 text-blue-400" />
                    {day.label}
                  </h3>
                )}
                {day.detail && <p className="text-slate-300 leading-relaxed">{day.detail}</p>}
                {day.subItems.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {day.subItems.map((sub, j) => (
                      <li key={j} className="flex gap-3 text-slate-300">
                        {sub.time ? (
                          <span className="flex items-center gap-1.5 shrink-0 text-sm font-semibold text-blue-300 min-w-[88px]">
                            <Clock className="w-3.5 h-3.5" />
                            {sub.time}
                          </span>
                        ) : (
                          <span className="shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-blue-400/60" />
                        )}
                        <span className="leading-relaxed">{sub.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {carryItems.length > 0 && (
        <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-blue-300 mb-4">
            <Package className="w-4 h-4" />
            Things to Carry
          </h3>
          <div className="flex flex-wrap gap-2">
            {carryItems.map((item, i) => (
              <span key={i} className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-sm text-slate-300">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {parsed.extras.map((extra, i) => (
        <div key={i} className="bg-white/5 p-6 rounded-3xl border border-white/10">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-blue-300 mb-1">{extra.label}</h3>
          <p className="text-slate-300 leading-relaxed">{extra.text}</p>
        </div>
      ))}
    </div>
  );
}
