import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

// ─── PDF.js — lazy-loaded on first use ───────────────────────────────────────
let _pdfjs = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('pdfjs-dist');
  // Use Vite's asset URL resolution so the worker bundle is properly served
  lib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href;
  _pdfjs = lib;
  return lib;
}

/**
 * Extract clean text from the first `maxPages` pages of a PDF file.
 * Only the opening pages are extracted (Abstract → Methods) which is
 * all DeepSeek needs — this keeps token usage ~10–20× lower than
 * sending the full document.
 */
async function extractPdfText(file, maxPages = 8) {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const total = pdf.numPages;
  const limit = Math.min(total, maxPages);
  const pageTexts = [];

  for (let n = 1; n <= limit; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();

    // Group text items by vertical position to reconstruct lines
    const byY = {};
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 4) * 4; // snap to 4px grid
      if (!byY[y]) byY[y] = [];
      byY[y].push({ x: item.transform[4], s: item.str });
    }
    const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
    const lines = ys
      .map(y => byY[y].sort((a, b) => a.x - b.x).map(i => i.s).join(' ').trim())
      .filter(Boolean);
    pageTexts.push(lines.join('\n'));
  }

  let text = pageTexts.join('\n\n');
  // Clean common PDF artifacts
  text = text
    .replace(/\f/g, '\n')                         // form feeds
    .replace(/(\w)-\s*\n\s*([a-z])/g, '$1$2')     // soft-hyphen line-breaks
    .replace(/\n{3,}/g, '\n\n')                   // max 2 consecutive newlines
    .replace(/[ \t]{2,}/g, ' ')                    // multiple spaces
    .trim();

  const note = limit < total
    ? `[Extracted from pages 1\u2013${limit} of ${total} — sufficient for Abstract/Methods analysis]\n\n`
    : `[Full document extracted: ${total} page${total !== 1 ? 's' : ''}]\n\n`;
  return note + text;
}

// ─── Icons (inline SVG) ─────────────────────────────────────────────────────
const IconSettings = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const IconPlus = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconEdit = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
);
const IconSearch = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClose = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconQuill = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>
  </svg>
);
const IconChevronDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const IconCitation = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>
  </svg>
);

const IconUpload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);
const IconFileText = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IconSun = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/>
  </svg>
);
const IconMoon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
);

// ─── Seed Data ───────────────────────────────────────────────────────────────
const SEED_PAPERS = [
  {
    id: 1,
    title: "Attention Is All You Need",
    authors: "Vaswani, A., Shazeer, N., Parmar, N., et al.",
    year: 2017,
    category: "Transformer Architectures",
    suggested_themes: ["Scalability & Compute Efficiency", "Transformer Architectures"],
    key_quotes: [
      { quote: "The Transformer allows for significantly more parallelization and can reach a new state of the art in translation quality.", theme: "Scalability & Compute Efficiency" }
    ],
    methodology: "Transformer architecture; multi-head self-attention mechanism replacing recurrence and convolutions entirely. Trained on WMT 2014 EN-DE and EN-FR translation tasks.",
    key_findings: "Achieved SOTA on EN-DE translation (28.4 BLEU) and EN-FR (41.0 BLEU). Training time reduced 12× vs. recurrent baselines. Attention heads learn interpretable syntactic and semantic roles.",
    limitations: "Quadratic complexity w.r.t. sequence length limits scalability to long contexts. Requires large training corpora and GPU clusters. No mechanism for explicit hierarchical structure.",
    citation_key: "vaswani2017attention",
    relevance_to_my_essay: "Foundational architecture underpinning all subsequent LLM developments; essential for contextualizing the emergence of scaling laws and prompt-based paradigms.",
  },
  {
    id: 2,
    title: "Scaling Laws for Neural Language Models",
    authors: "Kaplan, J., McCandlish, S., Henighan, T., et al.",
    year: 2020,
    category: "Scaling Laws",
    suggested_themes: ["Scalability & Compute Efficiency", "Scaling Laws"],
    key_quotes: [
      { quote: "Performance follows smooth power laws w.r.t. model size, dataset size, and compute budget independently.", theme: "Scalability & Compute Efficiency" }
    ],
    methodology: "Empirical study on GPT-family models across 6 orders of magnitude in compute, data, and parameter count. Power-law regression on test loss vs. scale.",
    key_findings: "Performance follows smooth power laws w.r.t. model size, dataset size, and compute budget independently. Compute-optimal training favors larger models trained on less data than previously assumed.",
    limitations: "Laws derived primarily on autoregressive LMs; generalization to other architectures (e.g., MoE, SSMs) is uncertain. Task-level performance may not follow perplexity scaling.",
    citation_key: "kaplan2020scaling",
    relevance_to_my_essay: "Provides the theoretical grounding for why researchers chose to scale models rather than architectural innovation — directly relevant to the compute efficiency debate in my Chapter 2.",
  },
  {
    id: 3,
    title: "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models",
    authors: "Wei, J., Wang, X., Schuurmans, D., et al.",
    year: 2022,
    category: "Prompt Engineering",
    suggested_themes: ["Emergent Capabilities & Prompting"],
    key_quotes: [
      { quote: "Chain-of-thought prompting yields emergent reasoning in models ≥100B params; flat below this threshold.", theme: "Emergent Capabilities & Prompting" }
    ],
    methodology: "Few-shot prompting with intermediate reasoning steps (chain-of-thought) across GPT-3, PaLM, and LaMDA. Evaluated on arithmetic, commonsense, and symbolic reasoning benchmarks.",
    key_findings: "CoT prompting yields emergent reasoning in models ≥100B params; flat below this threshold. 58% → 74% accuracy on GSM8K for PaLM 540B. Performance tracks model scale non-linearly.",
    limitations: "Efficacy dependent on prompt quality and model scale. Manual chain construction is costly. May hallucinate plausible-looking but incorrect reasoning chains.",
    citation_key: "wei2022cot",
    relevance_to_my_essay: "Central to the argument that prompting strategies can unlock capabilities without fine-tuning — supports the 'prompt engineering as emergent interface' thesis in my conclusion.",
  },
];

const SEED_THEMES = [
  {
    id: 1,
    theme_name: "Scalability & Compute Efficiency",
    linked_citations: ["kaplan2020scaling", "vaswani2017attention"],
    synthesis_draft: "Vaswani et al. (2017) introduced the transformer's quadratic attention bottleneck, which Kaplan et al. (2020) indirectly addressed by demonstrating that compute budget is better spent on larger models rather than longer training runs on smaller ones. Together, these works frame the central tension between architectural expressivity and computational tractability...",
  },
  {
    id: 2,
    theme_name: "Emergent Capabilities & Prompting",
    linked_citations: ["wei2022cot"],
    synthesis_draft: "Wei et al. (2022) demonstrate that chain-of-thought reasoning emerges discontinuously above ~100B parameters, suggesting that certain capabilities are not reducible to smooth scaling but instead represent phase transitions. This has significant implications for evaluating model 'intelligence' versus benchmark saturation...",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const generateId = () => Date.now() + Math.random();

const emptyPaper = () => ({
  id: generateId(),
  title: '', authors: '', year: new Date().getFullYear(),
  category: '',
  suggested_themes: [],
  key_quotes: [],
  methodology: '', key_findings: '', limitations: '',
  citation_key: '', relevance_to_my_essay: '',
});

const emptyTheme = () => ({
  id: generateId(),
  theme_name: '', linked_citations: [], synthesis_draft: '',
});

// ─── Citation Formatting Helpers ─────────────────────────────────────────────
function formatCitation(paper, style) {
  if (!paper) return '';
  const { title = '', authors = '', year } = paper;
  
  let cleanTitle = title.trim();
  if (cleanTitle && !cleanTitle.endsWith('.') && !cleanTitle.endsWith('?') && !cleanTitle.endsWith('!')) {
    cleanTitle += '.';
  }

  const cleanYear = year ? `${year}` : 'n.d.';

  let cleanAuthors = (authors || '').trim();
  if (!cleanAuthors) {
    cleanAuthors = 'Unknown Author';
  } else {
    if (cleanAuthors.endsWith(',')) {
      cleanAuthors = cleanAuthors.slice(0, -1);
    }
    if (!cleanAuthors.endsWith('.') && !cleanAuthors.toLowerCase().endsWith('et al.')) {
      if (cleanAuthors.toLowerCase().endsWith('et al')) {
        cleanAuthors += '.';
      } else {
        cleanAuthors += '.';
      }
    }
  }

  if (style === 'APA') {
    return `${cleanAuthors} (${cleanYear}). ${cleanTitle}`;
  } else {
    // Harvard style
    return `${cleanAuthors} ${cleanYear}. '${cleanTitle.replace(/\.$/, '')}'.`;
  }
}

function formatInTextCitation(paper, style) {
  if (!paper) return '';
  const { authors = '', year } = paper;
  const cleanYear = year || 'n.d.';
  
  let lastName = 'Unknown';
  const authorsTrimmed = authors.trim();
  
  if (authorsTrimmed) {
    const hasEtAl = /et\s+al/i.test(authorsTrimmed);
    let firstAuthor = '';
    
    if (authorsTrimmed.includes(';')) {
      firstAuthor = authorsTrimmed.split(';')[0].trim();
    } else if (authorsTrimmed.includes(',')) {
      firstAuthor = authorsTrimmed.split(',')[0].trim();
    } else {
      const words = authorsTrimmed.split(/\s+/);
      firstAuthor = words[words.length - 1] || 'Unknown';
    }
    
    // Extract last name if firstAuthor is "Last, F." or "First Last"
    if (firstAuthor.includes(' ')) {
      const words = firstAuthor.split(/\s+/);
      if (words.length > 0) {
        lastName = words[words.length - 1];
      }
    } else {
      lastName = firstAuthor;
    }
    
    const hasMultiple = hasEtAl || (authorsTrimmed.match(/,/g) || []).length > 1 || /\b(and|&)\b/i.test(authorsTrimmed);
    if (hasMultiple) {
      lastName = `${lastName} et al.`;
    }
  }
  
  return `(${lastName}, ${cleanYear})`;
}

// ─── Shared Style Constants ───────────────────────────────────────────────────
const inputCls = [
  "w-full bg-raised border border-rule rounded px-3 py-2",
  "text-sm text-ink font-sans placeholder-ink-4",
  "focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold",
  "transition-all duration-200 resize-none",
].join(' ');

// ─── TruncatedCell ────────────────────────────────────────────────────────────
function TruncatedCell({ text = '' }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 200;

  // Clean any literal '\n' sequences and split by actual newlines
  const paragraphs = String(text || '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return <span className="text-ink-4 italic">—</span>;
  }

  return (
    <div className="text-sm leading-relaxed text-ink-2">
      <div className={!expanded && isLong ? 'line-clamp-3' : 'space-y-1.5'}>
        {paragraphs.map((p, idx) => {
          // If the paragraph starts with a bullet character, let's render it as a bullet point
          const isBullet = /^[•\-\*\u2013\u2014]/.test(p);
          const cleanText = isBullet ? p.replace(/^[•\-\*\u2013\u2014]\s*/, '') : p;
          
          return (
            <div key={idx} className={isBullet ? 'flex items-start gap-1.5' : ''}>
              {isBullet && <span className="text-gold shrink-0 mt-1.5 select-none text-[8px]">■</span>}
              <p className={isBullet ? 'flex-1' : ''}>{cleanText}</p>
            </div>
          );
        })}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(p => !p)}
          className="mt-2 text-xs italic text-gold-dim hover:text-gold transition-colors duration-150 block"
        >
          {expanded ? '↑ collapse' : '↓ read more'}
        </button>
      )}
    </div>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────
function FormField({ label, children, required }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10.5px] font-sans font-medium uppercase tracking-[0.12em] text-ink-3">
        {label}{required && <span className="text-gold ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Ornamental Divider ───────────────────────────────────────────────────────
function OrnamentDivider({ label }) {
  return (
    <div className="flex items-center gap-4 my-2">
      <div className="flex-1 h-px bg-rule-dim" />
      <span className="text-[10px] font-sans uppercase tracking-[0.2em] text-ink-4 select-none">
        ◆ {label} ◆
      </span>
      <div className="flex-1 h-px bg-rule-dim" />
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ dialogRef, tokenLogs = [], onClearLogs }) {
  const [activeTab, setActiveTab] = useState('settings'); // 'settings' | 'logs'
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ds_api_key') || '');
  const [model, setModel] = useState(() => localStorage.getItem('ds_model') || 'deepseek-chat');
  const [saved, setSaved] = useState(false);

  function save() {
    localStorage.setItem('ds_api_key', apiKey);
    localStorage.setItem('ds_model', model);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const totalTokens = tokenLogs.reduce((sum, log) => sum + (log.totalTokens || 0), 0);
  // Estimate cost based on DeepSeek V3 price: prompt is $0.14/1M ($0.00000014), completion is $0.28/1M ($0.00000028)
  const totalCost = tokenLogs.reduce((sum, log) => {
    const pCost = (log.promptTokens || 0) * 0.00000014;
    const cCost = (log.completionTokens || 0) * 0.00000028;
    return sum + pCost + cCost;
  }, 0);

  return (
    <dialog ref={dialogRef} className="max-w-[500px]">
      <div className="p-7 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink tracking-wide">
              API &amp; Usage Panel
            </h2>
            <p className="text-xs text-ink-3 mt-1 font-sans leading-relaxed">
              Configure DeepSeek credentials and monitor your token ledger history.
            </p>
          </div>
          <button
            onClick={() => dialogRef.current?.close()}
            className="p-1.5 text-ink-3 hover:text-ink-2 hover:bg-raised rounded transition-all shrink-0 mt-0.5"
          >
            <IconClose />
          </button>
        </div>

        {/* Tab selection */}
        <div className="flex border-b border-rule-dim text-[11px] font-sans">
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 border-b-2 transition-colors -mb-px ${
              activeTab === 'settings'
                ? 'border-b-gold text-gold font-semibold'
                : 'border-b-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            Configuration
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
              activeTab === 'logs'
                ? 'border-b-gold text-gold font-semibold'
                : 'border-b-transparent text-ink-3 hover:text-ink-2'
            }`}
          >
            Usage Ledger
            {tokenLogs.length > 0 && (
              <span className="bg-gold-wash text-gold px-1 rounded-full text-[9px] scale-90 border border-gold-rule">
                {tokenLogs.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'settings' ? (
          <div className="space-y-5">
            <FormField label="DeepSeek API Key" required>
              <input
                type="password"
                className={inputCls}
                placeholder="sk-••••••••••••••••••••"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </FormField>

            <FormField label="Model">
              <div className="relative">
                <select
                  className={`${inputCls} appearance-none pr-8 cursor-pointer`}
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  <option value="deepseek-chat">deepseek-chat</option>
                  <option value="deepseek-reasoner">deepseek-reasoner</option>
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3">
                  <IconChevronDown />
                </span>
              </div>
            </FormField>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                onClick={() => dialogRef.current?.close()}
                className="px-4 py-2 text-sm rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised transition-all duration-200"
              >
                Dismiss
              </button>
              <button
                onClick={save}
                className="px-5 py-2 text-sm rounded bg-gold hover:bg-gold-dim text-canvas font-semibold transition-all duration-200"
              >
                {saved ? '✓ Saved' : 'Save Credentials'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary statistics */}
            <div className="grid grid-cols-3 gap-3 bg-panel border border-rule-dim rounded p-3 text-center">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-sans text-ink-3">Total Calls</p>
                <p className="font-display text-lg font-semibold text-ink mt-0.5">{tokenLogs.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-sans text-ink-3">Total Tokens</p>
                <p className="font-display text-lg font-semibold text-gold mt-0.5">{totalTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-sans text-ink-3">Est. Cost</p>
                <p className="font-display text-lg font-semibold text-ink mt-0.5">${totalCost.toFixed(5)}</p>
              </div>
            </div>

            {/* Scrollable logs */}
            <div className="border border-rule-dim rounded overflow-hidden max-h-56 overflow-y-auto divide-y divide-rule-dim bg-surface">
              {tokenLogs.length === 0 ? (
                <p className="text-xs italic text-ink-4 p-4 font-sans text-center">No token transactions logged yet.</p>
              ) : (
                tokenLogs.map(log => (
                  <div key={log.id} className="p-3 text-xs flex justify-between items-start gap-4">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-ink-2 font-sans font-medium leading-snug break-words">
                        {log.activity}
                      </p>
                      <p className="text-[9.5px] text-ink-4 font-sans">
                        {log.timestamp} · <span className="font-mono text-gold-dim">{log.model}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[10.5px]">
                      <p className="text-gold font-bold">{log.totalTokens.toLocaleString()} tkn</p>
                      <p className="text-[9px] text-ink-3">
                        p:{log.promptTokens} / c:{log.completionTokens}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex justify-between items-center pt-1">
              <button
                onClick={onClearLogs}
                disabled={tokenLogs.length === 0}
                className="px-3.5 py-2 text-xs rounded border border-rouge-rule bg-rouge-wash text-rouge hover:bg-rouge/15 disabled:opacity-40 disabled:pointer-events-none font-semibold transition-all duration-200"
              >
                Clear Ledger
              </button>
              <button
                onClick={() => dialogRef.current?.close()}
                className="px-5 py-2 text-sm rounded bg-gold hover:bg-gold-dim text-canvas font-semibold transition-all duration-200"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}

// ─── Paper Form Modal ─────────────────────────────────────────────────────────
function PaperFormModal({ dialogRef, initial, onSave, onAddTokenLog }) {
  const [form, setForm] = useState(initial || emptyPaper());
  const [abstractText, setAbstractText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  // PDF upload state
  const [inputMode, setInputMode] = useState('paste'); // 'paste' | 'upload'
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfInfo, setPdfInfo] = useState(null); // { name, pages, extracted }
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [selectedThemesToCreate, setSelectedThemesToCreate] = useState([]);

  useEffect(() => {
    if (initial) {
      // Clean any literal '\n' string representations from data
      setForm({
        ...initial,
        category: initial.category || '',
        suggested_themes: initial.suggested_themes || [],
        methodology: String(initial.methodology || '').replace(/\\n/g, '\n'),
        key_findings: String(initial.key_findings || '').replace(/\\n/g, '\n'),
        limitations: String(initial.limitations || '').replace(/\\n/g, '\n'),
        relevance_to_my_essay: String(initial.relevance_to_my_essay || '').replace(/\\n/g, '\n'),
      });
      setSelectedThemesToCreate([]);
    } else {
      setForm(emptyPaper());
      setSelectedThemesToCreate([]);
    }
    setAbstractText('');
    setAiError('');
    setInputMode('paste');
    setPdfInfo(null);
  }, [initial]);

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  // ── PDF handling ──
  async function handlePdfFile(file) {
    if (!file || file.type !== 'application/pdf') {
      setAiError('Please select a valid PDF file.');
      return;
    }
    setPdfLoading(true);
    setAiError('');
    try {
      const text = await extractPdfText(file, 8);
      setAbstractText(text);
      setPdfInfo({ name: file.name, size: (file.size / 1024).toFixed(0) });
      // Auto-switch to paste mode so user can review extracted text
      setInputMode('paste');
    } catch (err) {
      setAiError(`PDF extraction failed: ${err.message}`);
    } finally {
      setPdfLoading(false);
    }
  }

  function onFileInputChange(e) {
    const file = e.target.files?.[0];
    if (file) handlePdfFile(file);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePdfFile(file);
  }

  // ── AI auto-fill ──
  async function autoFill() {
    const apiKey = localStorage.getItem('ds_api_key');
    if (!apiKey) { setAiError('Please configure your DeepSeek API key in Settings first.'); return; }
    if (!abstractText.trim()) { setAiError('Please paste or upload text first.'); return; }

    setAiLoading(true);
    setAiError('');

    const systemPrompt = `You are an expert academic reviewer. Analyze the provided text and return ONLY a valid JSON object with exactly these ten keys:
{
  "title": "<full paper title as written, or null if not found>",
  "authors": "<authors formatted as 'Last, F., Last, F., et al.' — use et al. for more than 3 authors, or null if not found>",
  "year": <publication year as a plain integer, e.g. 2023, or null if not found>,
  "citation_key": "<concise citation key in format lastnameYYYYkeyword, all lowercase, no spaces, e.g. vaswani2017attention — derive from first author surname + year + first significant word of title, or null if not found>",
  "category": "<a broad academic subfield, research area, or category this paper belongs to, e.g., Large Language Models, Optimization, Computer Vision, etc. — keep it short, 1-3 words, or null if not found>",
  "suggested_themes": ["<theme name 1, e.g. Scaling Laws>", "<theme name 2, e.g. Transformer Limitations>"],
  "key_quotes": [
    {
      "quote": "<exact verbatim sentence or key passage from the text supporting a theme>",
      "theme": "<the exact name of the suggested theme this quote belongs to — MUST match one of the items in suggested_themes array>"
    }
  ],
  "methodology": "<concise description of the study's research design, methods, and analytical approach>",
  "key_findings": "<3-5 bullet-point summary of the main results and contributions>",
  "limitations": "<2-4 key limitations, constraints, or caveats acknowledged or apparent from the work>"
}
No markdown, no code fences, no extra keys, no explanation — only the raw JSON object.`;

    try {
      const model = localStorage.getItem('ds_model') || 'deepseek-chat';
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: abstractText },
          ],
          temperature: 0.3,
          max_tokens: 3000,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || '';
      let cleaned = raw.trim();
      
      // Robust JSON extraction: locate the outermost curly braces
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      } else {
        cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      }
      const parsed = JSON.parse(cleaned);

      setForm(p => ({
        ...p,
        // ── Bibliographic fields: fill only if the user hasn't typed anything
        //    (safe to use when editing — won't clobber existing data. Safe fallback for undefined properties)
        title:        (!(p.title || '').trim()        && parsed.title)
                        ? String(parsed.title)
                        : p.title,
        authors:      (!(p.authors || '').trim()      && parsed.authors)
                        ? String(parsed.authors)
                        : p.authors,
        year:         (!p.year                        && parsed.year)
                        ? Number(parsed.year)
                        : p.year,
        citation_key: (!(p.citation_key || '').trim() && parsed.citation_key)
                        ? String(parsed.citation_key).toLowerCase().replace(/\s+/g, '')
                        : p.citation_key,
        category:     (!(p.category || '').trim()     && parsed.category)
                        ? String(parsed.category)
                        : p.category,
        suggested_themes: parsed.suggested_themes || [],
        key_quotes:       parsed.key_quotes || [],
        // ── Analytical fields: always overwrite with AI output
        methodology:  parsed.methodology ? String(parsed.methodology).replace(/\\n/g, '\n') : p.methodology,
        key_findings: parsed.key_findings ? String(parsed.key_findings).replace(/\\n/g, '\n') : p.key_findings,
        limitations:  parsed.limitations ? String(parsed.limitations).replace(/\\n/g, '\n') : p.limitations,
      }));

      // Pre-select all proposed themes by default
      if (parsed.suggested_themes) {
        setSelectedThemesToCreate(parsed.suggested_themes);
      }

      // Log token usage if returned by API
      const usage = data.usage;
      if (usage && onAddTokenLog) {
        const finalTitle = (form.title || '').trim() || parsed.title || 'Untitled';
        onAddTokenLog({
          id: generateId(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
          activity: `Auto-filled paper: "${finalTitle}"`,
          model,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        });
      }
    } catch (err) {
      setAiError(`Analysis failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  function handleSave() {
    if (!(form.title || '').trim() || !(form.citation_key || '').trim()) {
      setAiError('Title and Citation Key are required fields.');
      return;
    }
    onSave(form, selectedThemesToCreate);
    dialogRef.current?.close();
  }

  return (
    <dialog ref={dialogRef} className="max-w-2xl">
      <div className="max-h-[90dvh] overflow-y-auto">
        {/* Modal header — sticky */}
        <div className="sticky top-0 z-10 bg-surface px-7 pt-6 pb-4 border-b border-rule-dim">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl italic font-medium text-ink">
              {initial?.id ? 'Edit Paper' : 'Add New Paper'}
            </h2>
            <button
              onClick={() => dialogRef.current?.close()}
              className="p-1.5 text-ink-3 hover:text-ink-2 hover:bg-raised rounded transition-all"
            >
              <IconClose />
            </button>
          </div>
        </div>

        <div className="px-7 py-5 space-y-5">
          {/* § Abstract Analysis panel */}
          <div className="bg-gold-wash border border-gold-rule rounded p-4 space-y-3">

            {/* Panel header + input-mode tabs */}
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] uppercase tracking-[0.14em] text-gold font-sans font-medium flex items-center gap-2">
                <IconQuill /> § Abstract Analysis
              </p>
              {/* Mode toggle */}
              <div className="flex border border-gold-rule rounded overflow-hidden text-[10.5px] font-sans">
                <button
                  onClick={() => setInputMode('paste')}
                  className={`px-3 py-1 transition-colors duration-150 ${
                    inputMode === 'paste'
                      ? 'bg-gold text-canvas font-semibold'
                      : 'text-gold-dim hover:text-gold'
                  }`}
                >
                  Paste Text
                </button>
                <button
                  onClick={() => setInputMode('upload')}
                  className={`px-3 py-1 border-l border-gold-rule transition-colors duration-150 flex items-center gap-1.5 ${
                    inputMode === 'upload'
                      ? 'bg-gold text-canvas font-semibold'
                      : 'text-gold-dim hover:text-gold'
                  }`}
                >
                  <IconUpload /> Upload PDF
                </button>
              </div>
            </div>

            {/* ── Paste mode ── */}
            {inputMode === 'paste' && (
              <>
                {pdfInfo && (
                  <div className="flex items-center gap-2 text-[11px] font-sans text-gold-dim bg-gold-wash border border-gold-rule rounded px-3 py-1.5">
                    <IconFileText />
                    <span className="font-mono truncate max-w-[260px]">{pdfInfo.name}</span>
                    <span className="text-ink-4 ml-auto shrink-0">{pdfInfo.size} KB extracted</span>
                    <button
                      onClick={() => { setPdfInfo(null); setAbstractText(''); }}
                      className="ml-1 text-ink-4 hover:text-rouge transition-colors"
                      title="Clear extracted text"
                    >
                      <IconClose />
                    </button>
                  </div>
                )}
                <FormField label={pdfInfo ? 'Extracted Text (review before analysing)' : 'Paste Abstract or Journal Text'}>
                  <textarea
                    className={`${inputCls} min-h-[110px]`}
                    placeholder="Paste the full abstract, introduction, or any journal text to analyse…"
                    value={abstractText}
                    onChange={e => setAbstractText(e.target.value)}
                  />
                </FormField>
              </>
            )}

            {/* ── Upload mode ── */}
            {inputMode === 'upload' && (
              <>
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={onFileInputChange}
                />
                {/* Dropzone */}
                <div
                  onClick={() => !pdfLoading && fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={[
                    'flex flex-col items-center justify-center gap-3 rounded border-2 border-dashed py-10 px-6',
                    'cursor-pointer transition-all duration-200 select-none',
                    dragOver
                      ? 'border-gold bg-gold/10'
                      : 'border-gold-rule hover:border-gold-dim hover:bg-gold/5',
                    pdfLoading ? 'pointer-events-none' : '',
                  ].join(' ')}
                >
                  {pdfLoading ? (
                    <>
                      <span className="w-8 h-8 border-2 border-gold-rule border-t-gold rounded-full animate-spin" />
                      <p className="text-sm font-sans text-gold-dim">Extracting text from PDF…</p>
                      <p className="text-xs font-sans text-ink-4">Processing pages — this may take a moment</p>
                    </>
                  ) : (
                    <>
                      <span className="text-gold-dim opacity-60"><IconFileText /></span>
                      <div className="text-center">
                        <p className="font-display text-base italic text-ink-2">
                          Drop a PDF here, or click to browse
                        </p>
                        <p className="text-xs font-sans text-ink-4 mt-1">
                          Pages 1–8 extracted · text converted locally · no upload to server
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-sans uppercase tracking-[0.12em] text-ink-4">
                        <span className="w-6 h-px bg-rule-dim" />
                        Token-efficient: ~95% smaller than full PDF
                        <span className="w-6 h-px bg-rule-dim" />
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Error message */}
            {aiError && (
              <p className="text-xs font-sans text-rouge bg-rouge-wash border border-rouge-rule rounded px-3 py-2 leading-relaxed">
                {aiError}
              </p>
            )}

            {/* Auto-fill button — only relevant once there's text */}
            <div className="flex items-center gap-3">
              <button
                onClick={autoFill}
                disabled={aiLoading || !abstractText.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded bg-gold hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed text-canvas text-sm font-semibold transition-all duration-200"
              >
                {aiLoading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-[1.5px] border-canvas/30 border-t-canvas rounded-full animate-spin" />
                    Analysing…
                  </>
                ) : (
                  <><IconQuill /> Auto-Fill via DeepSeek</>
                )}
              </button>
              {abstractText.trim() && !aiLoading && (
                <p className="text-[10.5px] font-sans text-ink-4">
                  ~{Math.ceil(abstractText.split(/\s+/).length * 1.3).toLocaleString()} est. tokens
                </p>
              )}
            </div>
          </div>

          {/* Basic bibliographic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label="Paper Title" required>
                <input className={inputCls} placeholder="Full title of the work…" value={form.title} onChange={e => set('title', e.target.value)} />
              </FormField>
            </div>
            <FormField label="Authors">
              <input className={inputCls} placeholder="Last, F., Last, F., et al." value={form.authors} onChange={e => set('authors', e.target.value)} />
            </FormField>
            <FormField label="Category / Field">
              <input className={inputCls} placeholder="e.g. Deep Learning, Optimization" value={form.category || ''} onChange={e => set('category', e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3 col-span-2">
              <FormField label="Year">
                <input type="number" className={inputCls} placeholder="2024" value={form.year} onChange={e => set('year', +e.target.value)} />
              </FormField>
              <FormField label="Citation Key" required>
                <input className={inputCls} placeholder="smith2024title" value={form.citation_key} onChange={e => set('citation_key', e.target.value)} />
              </FormField>
            </div>
          </div>

          <div className="h-px bg-rule-dim" />

          {/* AI-populated analytical fields */}
          <FormField label="Methodology">
            <textarea className={`${inputCls} min-h-[80px] ${aiLoading ? 'skeleton' : ''}`} placeholder="Research design, methods, data sources, analytical approach…" value={form.methodology} onChange={e => set('methodology', e.target.value)} disabled={aiLoading} />
          </FormField>
          <FormField label="Key Findings">
            <textarea className={`${inputCls} min-h-[80px] ${aiLoading ? 'skeleton' : ''}`} placeholder="Principal results and intellectual contributions…" value={form.key_findings} onChange={e => set('key_findings', e.target.value)} disabled={aiLoading} />
          </FormField>
          <FormField label="Limitations">
            <textarea className={`${inputCls} min-h-[68px] ${aiLoading ? 'skeleton' : ''}`} placeholder="Study constraints, acknowledged caveats, generalisability concerns…" value={form.limitations} onChange={e => set('limitations', e.target.value)} disabled={aiLoading} />
          </FormField>
          <FormField label="Relevance to My Essay">
            <textarea className={`${inputCls} min-h-[68px]`} placeholder="How this work supports or challenges your argument…" value={form.relevance_to_my_essay} onChange={e => set('relevance_to_my_essay', e.target.value)} />
          </FormField>

          {/* Suggested Themes Recommendations */}
          {form.suggested_themes && form.suggested_themes.length > 0 && (
            <div className="bg-panel border border-rule-dim rounded p-4 space-y-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-gold font-sans font-medium">
                  ◆ Suggested Synthesis Themes
                </p>
                <p className="text-xs text-ink-3 mt-1 font-sans leading-relaxed">
                  Select themes to automatically create and link this paper to when saving:
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5 pt-1">
                {form.suggested_themes.map(t => {
                  const isSelected = selectedThemesToCreate.includes(t);
                  return (
                    <label
                      key={t}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded border text-xs cursor-pointer select-none transition-all duration-150 ${
                        isSelected
                          ? 'border-gold bg-gold-wash text-gold font-semibold'
                          : 'border-rule hover:border-gold-dim bg-raised text-ink-2'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          setSelectedThemesToCreate(prev =>
                            prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
                          );
                        }}
                        className="accent-[oklch(73%_0.13_76)] w-3.5 h-3.5"
                      />
                      {t}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Key Quotes Extracted */}
          {form.key_quotes && form.key_quotes.length > 0 && (
            <div className="bg-panel border border-rule-dim rounded p-4 space-y-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.14em] text-gold font-sans font-medium">
                  ◆ Extracted Key Quotes
                </p>
                <p className="text-xs text-ink-3 mt-1 font-sans leading-relaxed">
                  Key passages extracted from the text by AI:
                </p>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {form.key_quotes.map((q, idx) => (
                  <div key={idx} className="bg-raised border border-rule-dim rounded p-2.5 text-xs text-ink-2 font-serif">
                    <p className="italic">"{q.quote}"</p>
                    {q.theme && (
                      <span className="inline-block mt-1.5 px-1.5 py-0.5 bg-gold-wash text-gold font-sans text-[9px] rounded uppercase tracking-wider font-semibold">
                        Theme: {q.theme}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal footer — sticky */}
        <div className="sticky bottom-0 bg-surface border-t border-rule-dim px-7 py-4 flex justify-end gap-2.5">
          <button
            onClick={() => dialogRef.current?.close()}
            className="px-4 py-2 text-sm rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised transition-all duration-200"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm rounded bg-gold hover:bg-gold-dim text-canvas font-semibold transition-all duration-200"
          >
            Save Paper
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Delete Confirm Modal ─────────────────────────────────────────────────────
function ConfirmModal({ dialogRef, message, onConfirm }) {
  return (
    <dialog ref={dialogRef} className="max-w-sm">
      <div className="p-7 space-y-5">
        <h2 className="font-display text-2xl font-semibold text-ink">Confirm Deletion</h2>
        <p className="text-sm font-sans text-ink-2 leading-relaxed">{message}</p>
        <div className="h-px bg-rule-dim" />
        <div className="flex justify-end gap-2.5">
          <button
            onClick={() => dialogRef.current?.close()}
            className="px-4 py-2 text-sm rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); dialogRef.current?.close(); }}
            className="px-5 py-2 text-sm rounded bg-rouge-wash border border-rouge-rule text-rouge hover:bg-rouge/15 font-semibold transition-all duration-200"
          >
            Delete Permanently
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Citation Modal ──────────────────────────────────────────────────────────
function CitationModal({ dialogRef, paper, style, setStyle }) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCit, setCopiedCit] = useState(false);
  const [copiedInText, setCopiedInText] = useState(false);

  if (!paper) return null;

  const fullCitation = formatCitation(paper, style);
  const inTextCitation = formatInTextCitation(paper, style);

  function copyText(text, setCopiedFlag) {
    navigator.clipboard.writeText(text);
    setCopiedFlag(true);
    setTimeout(() => setCopiedFlag(false), 1500);
  }

  return (
    <dialog ref={dialogRef} className="max-w-[500px]">
      <div className="p-7 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink tracking-wide">
              Scholarly Citation
            </h2>
            <p className="text-xs text-ink-3 mt-1 font-sans leading-relaxed italic font-serif">
              {paper.title}
            </p>
          </div>
          <button
            onClick={() => dialogRef.current?.close()}
            className="p-1.5 text-ink-3 hover:text-ink-2 hover:bg-raised rounded transition-all shrink-0 mt-0.5"
          >
            <IconClose />
          </button>
        </div>

        <div className="h-px bg-rule-dim" />

        {/* Style Selector */}
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] font-sans font-medium uppercase tracking-[0.12em] text-ink-3">
            Citation Style
          </span>
          <div className="flex border border-rule rounded overflow-hidden text-[11px] font-sans">
            <button
              onClick={() => setStyle('APA')}
              className={`px-4 py-1.5 transition-colors duration-150 ${
                style === 'APA'
                  ? 'bg-gold text-canvas font-semibold'
                  : 'text-gold-dim hover:text-gold'
              }`}
            >
              APA 7th
            </button>
            <button
              onClick={() => setStyle('Harvard')}
              className={`px-4 py-1.5 border-l border-rule transition-colors duration-150 ${
                style === 'Harvard'
                  ? 'bg-gold text-canvas font-semibold'
                  : 'text-gold-dim hover:text-gold'
              }`}
            >
              Harvard
            </button>
          </div>
        </div>

        {/* Citation Box */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-sans font-medium uppercase tracking-[0.12em] text-ink-3">
                Full Reference
              </span>
              <button
                onClick={() => copyText(fullCitation, setCopiedCit)}
                className="text-xs text-gold-dim hover:text-gold transition-colors font-sans"
              >
                {copiedCit ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="w-full bg-raised border border-rule rounded p-3 text-sm text-ink-2 font-serif leading-relaxed select-all">
              {fullCitation}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-sans font-medium uppercase tracking-[0.12em] text-ink-3">
                In-Text Citation
              </span>
              <button
                onClick={() => copyText(inTextCitation, setCopiedInText)}
                className="text-xs text-gold-dim hover:text-gold transition-colors font-sans"
              >
                {copiedInText ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="w-full bg-raised border border-rule rounded p-3 text-sm text-ink-2 font-serif leading-relaxed select-all">
              {inTextCitation}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-sans font-medium uppercase tracking-[0.12em] text-ink-3">
                Citation Key
              </span>
              <button
                onClick={() => copyText(paper.citation_key, setCopiedKey)}
                className="text-xs text-gold-dim hover:text-gold transition-colors font-sans"
              >
                {copiedKey ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <div className="w-full bg-raised border border-rule rounded p-3 text-sm text-ink-2 font-mono leading-relaxed select-all">
              {paper.citation_key}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-1">
          <button
            onClick={() => dialogRef.current?.close()}
            className="px-5 py-2 text-sm rounded bg-gold hover:bg-gold-dim text-canvas font-semibold transition-all duration-200"
          >
            Dismiss
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Theme Form Modal ─────────────────────────────────────────────────────────
function ThemeFormModal({ dialogRef, initial, papers, onSave, onAddTokenLog, citationStyle }) {
  const [form, setForm] = useState(initial || emptyTheme());
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    setForm(initial || emptyTheme());
    setAiError('');
  }, [initial]);

  function toggleCitation(key) {
    setForm(p => ({
      ...p,
      linked_citations: p.linked_citations.includes(key)
        ? p.linked_citations.filter(k => k !== key)
        : [...p.linked_citations, key],
    }));
  }

  function handleSave() {
    if (!form.theme_name.trim()) return;
    onSave(form);
    dialogRef.current?.close();
  }

  async function generateDraftWithAi(shouldSaveAfter = false) {
    if (!form.theme_name.trim()) {
      setAiError('Please enter a Theme Name first.');
      return;
    }
    if (form.linked_citations.length === 0) {
      setAiError('Please link at least one paper first.');
      return;
    }

    const apiKey = localStorage.getItem('ds_api_key');
    if (!apiKey) {
      setAiError('Please configure your DeepSeek API key in Settings first.');
      return;
    }

    setAiLoading(true);
    setAiError('');

    const linkedPapers = papers.filter(p => form.linked_citations.includes(p.citation_key));
    const style = citationStyle || 'APA';

    const paperSummaries = linkedPapers.map(p => `
Paper: ${p.title}
Authors: ${p.authors}
Year: ${p.year}
Citation Key: [${p.citation_key}]
Methodology: ${p.methodology}
Key Findings: ${p.key_findings}
Relevance: ${p.relevance_to_my_essay}
Key Quotes: ${(p.key_quotes || []).filter(q => q.theme?.toLowerCase() === form.theme_name.toLowerCase()).map(q => `"${q.quote}"`).join(', ')}
`).join('\n---\n');

    const systemPrompt = `You are a world-class academic writing assistant. Your task is to write a cohesive, intellectually rigorous, and beautifully styled academic synthesis draft paragraph for the research theme: "${form.theme_name}".

You must integrate the insights, methodologies, and contributions of the provided papers.
Guidelines:
1. Write a single, well-structured academic paragraph (or maximum two paragraphs if highly complex).
2. Synthesize similarities, contrasts, and relationships between the papers. Do NOT just list summaries of one paper after another.
3. Integrate parenthetical in-text citations naturally matching the ${style} format (e.g. '(Vaswani et al., 2017)' for APA, or '(Vaswani et al., 2017)' for Harvard).
4. Output ONLY the raw paragraph text. No markdown formatting, no code fences, no introductory remarks.
5. Maintain a professional, high-quality scholarly tone.`;

    try {
      const model = localStorage.getItem('ds_model') || 'deepseek-chat';
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is the corpus of papers to synthesize:\n\n${paperSummaries}` },
          ],
          temperature: 0.5,
          max_tokens: 1500,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const draft = data.choices?.[0]?.message?.content || '';
      const cleanedDraft = draft.replace(/```/g, '').trim();

      const updatedForm = { ...form, synthesis_draft: cleanedDraft };
      
      if (shouldSaveAfter) {
        onSave(updatedForm);
        dialogRef.current?.close();
      } else {
        setForm(updatedForm);
      }

      const usage = data.usage;
      if (usage && onAddTokenLog) {
        onAddTokenLog({
          id: Date.now() + Math.random(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
          activity: shouldSaveAfter
            ? `Auto-drafted and created theme: "${form.theme_name}"`
            : `AI-drafted synthesis for new theme: "${form.theme_name}"`,
          model,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        });
      }
    } catch (err) {
      setAiError(`AI drafting failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="max-w-lg">
      <div className="p-7 space-y-5 max-h-[85dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-2xl italic font-medium text-ink">
            {initial?.id ? 'Edit Theme' : 'New Synthesis Theme'}
          </h2>
          <button onClick={() => dialogRef.current?.close()} className="p-1.5 text-ink-3 hover:text-ink-2 hover:bg-raised rounded transition-all shrink-0">
            <IconClose />
          </button>
        </div>

        <div className="h-px bg-rule-dim" />

        <FormField label="Theme Name" required>
          <input className={inputCls} placeholder="e.g., Methodological Limitations" value={form.theme_name} onChange={e => setForm(p => ({ ...p, theme_name: e.target.value }))} />
        </FormField>

        <FormField label="Link Papers by Citation Key">
          <div className="rounded border border-rule-dim overflow-hidden divide-y divide-rule-dim max-h-52 overflow-y-auto">
            {papers.length === 0 && (
              <p className="text-xs italic text-ink-4 p-3 font-sans">No papers in the corpus yet.</p>
            )}
            {papers.map(p => (
              <label
                key={p.id}
                className="flex items-start gap-3 px-3 py-2.5 hover:bg-raised cursor-pointer transition-colors duration-150 group"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[oklch(73%_0.13_76)] w-3.5 h-3.5 shrink-0"
                  checked={form.linked_citations.includes(p.citation_key)}
                  onChange={() => toggleCitation(p.citation_key)}
                />
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-gold truncate">[{p.citation_key}]</p>
                  <p className="text-xs text-ink-2 truncate leading-snug mt-0.5">{p.title}</p>
                </div>
              </label>
            ))}
          </div>
        </FormField>

        {aiError && (
          <p className="text-xs font-sans text-rouge bg-rouge-wash border border-rouge-rule rounded px-3 py-1.5 leading-relaxed">
            {aiError}
          </p>
        )}

        <FormField label="Synthesis Draft">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-ink-3">Compose manually or use AI to draft:</span>
            <button
              onClick={() => generateDraftWithAi(false)}
              disabled={aiLoading || !form.theme_name.trim() || form.linked_citations.length === 0}
              className="text-[10.5px] font-sans text-gold hover:text-gold-dim font-bold flex items-center gap-1 disabled:opacity-40 transition-colors"
            >
              {aiLoading ? 'Drafting...' : '✨ Draft with AI'}
            </button>
          </div>
          <textarea
            className={`${inputCls} min-h-[140px] leading-relaxed`}
            placeholder="Compose your synthesis paragraph here, weaving the linked citations into a coherent scholarly argument…"
            value={form.synthesis_draft}
            onChange={e => setForm(p => ({ ...p, synthesis_draft: e.target.value }))}
          />
        </FormField>

        <div className="flex justify-end gap-2.5 pt-1">
          <button onClick={() => dialogRef.current?.close()} className="px-4 py-2 text-sm rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised transition-all duration-200">
            Discard
          </button>
          <button
            onClick={() => generateDraftWithAi(true)}
            disabled={aiLoading || !form.theme_name.trim() || form.linked_citations.length === 0}
            className="px-4 py-2 text-sm rounded bg-gold hover:bg-gold-dim text-canvas font-semibold transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
          >
            {aiLoading ? 'Generating...' : '✨ Draft & Save with AI'}
          </button>
          <button onClick={handleSave} className="px-5 py-2 text-sm rounded bg-verd-wash border border-verd-rule text-verd hover:bg-verd/15 font-semibold transition-all duration-200">
            Save Theme
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Matrix Table ─────────────────────────────────────────────────────────────
function MatrixTable({ papers, onEdit, onDelete, onCite }) {
  if (papers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="font-display text-2xl italic text-ink-4 select-none">No papers in the corpus</p>
        <p className="text-sm font-sans text-ink-4">Add a paper to begin populating the review matrix.</p>
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto"
      style={{ overscrollBehaviorX: 'contain', scrollbarGutter: 'stable' }}
    >
      <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', minWidth: 'max-content' }}>
        <colgroup>
          <col style={{ width: 268 }} />
          <col style={{ width: 196 }} />
          <col style={{ width: 306 }} />
          <col style={{ width: 344 }} />
          <col style={{ width: 282 }} />
          <col style={{ width: 282 }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <thead>
          <tr className="border-b-2 border-rule text-left">
            {/* Sticky first column header */}
            <th className="sticky left-0 z-10 bg-panel py-3.5 px-5 border-r border-rule">
              <span className="text-[10px] uppercase tracking-[0.14em] font-sans font-medium text-ink-3">
                Title &amp; Reference
              </span>
            </th>
            {['Authors &amp; Year', 'Methodology', 'Key Findings', 'Limitations', 'Relevance to Essay', 'Actions'].map(h => (
              <th key={h} className="py-3.5 px-4">
                <span className="text-[10px] uppercase tracking-[0.14em] font-sans font-medium text-ink-3" dangerouslySetInnerHTML={{ __html: h }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {papers.map((paper, i) => (
            <tr
              key={paper.id}
              className="border-b border-rule-dim hover:bg-panel/70 transition-colors duration-150 group"
            >
              {/* Sticky title column */}
              <td className="sticky left-0 z-10 bg-surface group-hover:bg-panel/70 py-4 px-5 border-r border-rule-dim transition-colors duration-150 align-top">
                <p className="font-display text-base font-medium text-ink leading-snug mb-2">
                  {paper.title || <span className="text-ink-4 italic font-sans text-sm">Untitled</span>}
                </p>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <button
                    onClick={() => onCite(paper)}
                    className="inline-flex items-center gap-1 text-[10px] font-mono bg-gold-wash text-gold border border-gold-rule rounded px-1.5 py-0.5 hover:bg-gold/15 transition-all text-left"
                    title="Generate Citation"
                  >
                    <IconCitation />{paper.citation_key || '—'}
                  </button>
                  {paper.category && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-sans bg-panel text-ink-3 border border-rule-dim rounded px-1.5 py-0.5">
                      {paper.category}
                    </span>
                  )}
                </div>
              </td>

              <td className="py-4 px-4 align-top">
                <p className="text-sm text-ink-2 leading-snug font-sans">
                  {paper.authors || <span className="text-ink-4 italic">—</span>}
                </p>
                {paper.year && (
                  <p className="text-[11px] font-mono text-ink-3 mt-1.5">{paper.year}</p>
                )}
              </td>

              <td className="py-4 px-4 align-top"><TruncatedCell text={paper.methodology} /></td>
              <td className="py-4 px-4 align-top"><TruncatedCell text={paper.key_findings} /></td>
              <td className="py-4 px-4 align-top"><TruncatedCell text={paper.limitations} /></td>
              <td className="py-4 px-4 align-top"><TruncatedCell text={paper.relevance_to_my_essay} /></td>

              <td className="py-4 px-4 align-top">
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => onCite(paper)}
                    className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border border-gold-rule bg-gold-wash text-gold hover:bg-gold/15 text-xs transition-all duration-150 w-full font-semibold"
                    title="Generate citation"
                  >
                    <IconCitation /> Cite
                  </button>
                  <button
                    onClick={() => onEdit(paper)}
                    className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border border-rule text-ink-3 hover:text-ink-2 hover:border-rule text-xs transition-all duration-150 w-full"
                    title="Edit paper"
                  >
                    <IconEdit /> Edit
                  </button>
                  <button
                    onClick={() => onDelete(paper)}
                    className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded border border-rouge-rule bg-rouge-wash text-rouge hover:bg-rouge/15 text-xs transition-all duration-150 w-full"
                    title="Remove from corpus"
                  >
                    <IconTrash /> Remove
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Synthesis Builder ────────────────────────────────────────────────────────
function SynthesisBuilder({ themes, papers, onAddTheme, onEditTheme, onDeleteTheme, onUpdateThemeDraft, onUpdateThemeCitations, onAddGeneratedThemes, onAddTokenLog }) {
  const [activeTheme, setActiveTheme] = useState(themes[0]?.id || null);
  const [bibStyle, setBibStyle] = useState('APA');
  const [copiedBib, setCopiedBib] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [refinementInput, setRefinementInput] = useState('');
  
  const [autoGenLoading, setAutoGenLoading] = useState(false);
  const [autoGenError, setAutoGenError] = useState('');

  async function generateThemesFromCorpus() {
    const apiKey = localStorage.getItem('ds_api_key');
    if (!apiKey) {
      setAutoGenError('Configure your DeepSeek API key in settings first.');
      return;
    }
    if (papers.length === 0) {
      setAutoGenError('Add some papers to your corpus first.');
      return;
    }

    setAutoGenLoading(true);
    setAutoGenError('');

    const paperList = papers.map(p => `
Paper: ${p.title}
Authors: ${p.authors}
Year: ${p.year}
Citation Key: [${p.citation_key}]
Category: ${p.category}
Methodology: ${p.methodology}
Key Findings: ${p.key_findings}
Suggested Themes: ${(p.suggested_themes || []).join(', ')}
`).join('\n---\n');

    const systemPrompt = `You are a senior research synthesiser. Your task is to analyze the entire corpus of papers provided and identify 3 to 5 logical, overarching synthesis themes that connect these works.
For each theme, you must:
1. Provide a name for the theme (e.g. "Compute Scaling Bottlenecks").
2. Determine which papers from the corpus support or relate to this theme (represented as a list of citation keys). A paper can be linked to multiple themes, and a theme must contain at least one paper.
3. Write a cohesive academic synthesis paragraph (synthesis draft) that weaves the linked papers together with natural in-text citations.

Return ONLY a valid JSON array of objects with exactly this structure:
[
  {
    "theme_name": "<theme name, e.g. Compute Scaling Bottlenecks>",
    "linked_citations": ["vaswani2017attention", "kaplan2020scaling"],
    "synthesis_draft": "<cohesive synthesis draft paragraph with natural citations>"
  }
]

No markdown formatting, no code fences, no extra text, only the raw JSON array.`;

    try {
      const model = localStorage.getItem('ds_model') || 'deepseek-chat';
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Here is the corpus of papers to analyze:\n\n${paperList}` },
          ],
          temperature: 0.6,
          max_tokens: 3000,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || '';
      let cleaned = raw.trim();
      
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1) {
        cleaned = cleaned.substring(firstBracket, lastBracket + 1);
      } else {
        cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      }

      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        const newThemes = parsed.map(t => ({
          id: Date.now() + Math.random(),
          theme_name: String(t.theme_name),
          linked_citations: Array.isArray(t.linked_citations) ? t.linked_citations : [],
          synthesis_draft: String(t.synthesis_draft || ''),
        }));
        
        onAddGeneratedThemes(newThemes);
        if (newThemes.length > 0) {
          setActiveTheme(newThemes[0].id);
        }
      } else {
        throw new Error('Response is not a valid JSON array.');
      }

      const usage = data.usage;
      if (usage && onAddTokenLog) {
        onAddTokenLog({
          id: Date.now() + Math.random(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
          activity: `Auto-generated ${parsed.length} themes from corpus`,
          model,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        });
      }
    } catch (err) {
      setAutoGenError(`Auto-generation failed: ${err.message}`);
    } finally {
      setAutoGenLoading(false);
    }
  }

  useEffect(() => {
    if (!activeTheme && themes.length > 0) setActiveTheme(themes[0].id);
  }, [themes]);

  const theme = themes.find(t => t.id === activeTheme);
  const linkedPapers = theme ? papers.filter(p => theme.linked_citations.includes(p.citation_key)) : [];

  const recommendedPapers = useMemo(() => {
    if (!theme) return [];
    return papers.filter(p => {
      const isLinked = theme.linked_citations.includes(p.citation_key);
      if (isLinked) return false;

      const categoryMatch = p.category && (
        p.category.toLowerCase().includes(theme.theme_name.toLowerCase()) ||
        theme.theme_name.toLowerCase().includes(p.category.toLowerCase())
      );

      const suggestedThemeMatch = (p.suggested_themes || []).some(st =>
        st.toLowerCase().includes(theme.theme_name.toLowerCase()) ||
        theme.theme_name.toLowerCase().includes(st.toLowerCase())
      );

      return categoryMatch || suggestedThemeMatch;
    });
  }, [theme, papers]);

  async function generateSynthesisWithAi(refinementPrompt = "") {
    const apiKey = localStorage.getItem('ds_api_key');
    if (!apiKey) {
      setAiError('Configure your DeepSeek API key in settings first.');
      return;
    }
    if (linkedPapers.length === 0) {
      setAiError('Link some papers to this theme first.');
      return;
    }

    setAiLoading(true);
    setAiError('');

    const paperSummaries = linkedPapers.map(p => `
Paper: ${p.title}
Authors: ${p.authors}
Year: ${p.year}
Citation Key: [${p.citation_key}]
Methodology: ${p.methodology}
Key Findings: ${p.key_findings}
Relevance: ${p.relevance_to_my_essay}
Key Quotes: ${(p.key_quotes || []).filter(q => q.theme?.toLowerCase() === theme.theme_name.toLowerCase()).map(q => `"${q.quote}"`).join(', ')}
`).join('\n---\n');

    let systemPrompt = "";
    let userContent = "";

    if (refinementPrompt) {
      systemPrompt = `You are a world-class academic writing assistant. Your task is to REFINE and EDIT the existing academic synthesis draft paragraph for the research theme: "${theme.theme_name}".
You must incorporate the user's specific instruction to revise the text.
Guidelines:
1. Modify the existing draft based on the instructions. Keep the style academic, cohesive, and intellectually rigorous.
2. Ensure you still integrate the insights, methodologies, and contributions of the provided papers.
3. Keep parenthetical in-text citations matching the ${bibStyle} format.
4. Output ONLY the revised raw paragraph text. No markdown formatting, no code fences, no introductory remarks.
5. Maintain a professional, high-quality scholarly tone.`;

      userContent = `Here is the current draft:\n\n${theme.synthesis_draft}\n\nHere are the linked papers:\n\n${paperSummaries}\n\nUser Instruction for Refinement: "${refinementPrompt}"`;
    } else {
      systemPrompt = `You are a world-class academic writing assistant. Your task is to write a cohesive, intellectually rigorous, and beautifully styled academic synthesis draft paragraph for the research theme: "${theme.theme_name}".

You must integrate the insights, methodologies, and contributions of the provided papers.
Guidelines:
1. Write a single, well-structured academic paragraph (or maximum two paragraphs if highly complex).
2. Synthesize similarities, contrasts, and relationships between the papers. Do NOT just list summaries of one paper after another.
3. Integrate parenthetical in-text citations naturally matching the ${bibStyle} format (e.g. '(Vaswani et al., 2017)' for APA, or '(Vaswani et al., 2017)' for Harvard).
4. Output ONLY the raw paragraph text. No markdown formatting, no code fences, no introductory remarks.
5. Maintain a professional, high-quality scholarly tone.`;

      userContent = `Here is the corpus of papers to synthesize:\n\n${paperSummaries}`;
    }

    try {
      const model = localStorage.getItem('ds_model') || 'deepseek-chat';
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: refinementPrompt ? 0.4 : 0.5,
          max_tokens: 1500,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const draft = data.choices?.[0]?.message?.content || '';
      
      const cleanedDraft = draft.replace(/```/g, '').trim();
      onUpdateThemeDraft(theme.id, cleanedDraft);

      const usage = data.usage;
      if (usage && onAddTokenLog) {
        onAddTokenLog({
          id: Date.now() + Math.random(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + new Date().toLocaleDateString(),
          activity: refinementPrompt 
            ? `Refined AI Synthesis Draft for Theme: "${theme.theme_name}"`
            : `Generated AI Synthesis Draft for Theme: "${theme.theme_name}"`,
          model,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        });
      }
    } catch (err) {
      setAiError(`Synthesis drafting failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[268px_1fr] min-h-[440px] border border-rule rounded overflow-hidden">

      {/* ── Theme index sidebar ── */}
      <div className="bg-panel border-r border-rule flex flex-col">
        {/* Sidebar header */}
        <div className="flex flex-col gap-2 px-4 py-3 border-b border-rule-dim">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.18em] font-sans font-medium text-ink-3">
              Themes
            </span>
            <button
              onClick={onAddTheme}
              className="flex items-center gap-1 text-[10.5px] px-2.5 py-1 rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised transition-all"
            >
              <IconPlus /> Manual
            </button>
          </div>
          <button
            onClick={generateThemesFromCorpus}
            disabled={autoGenLoading || papers.length === 0}
            className="w-full flex items-center justify-center gap-1.5 text-[10.5px] py-2 rounded border border-gold-rule bg-gold-wash text-gold hover:bg-gold/15 transition-all disabled:opacity-40 disabled:pointer-events-none font-semibold"
          >
            {autoGenLoading ? (
              <>
                <span className="inline-block w-3 h-3 border-[1.5px] border-gold/30 border-t-gold rounded-full animate-spin mr-1" />
                Generating…
              </>
            ) : (
              <>✨ Auto-Generate Themes</>
            )}
          </button>
        </div>

        {autoGenError && (
          <div className="p-3 text-[11px] font-sans text-rouge bg-rouge-wash border-b border-rouge-rule leading-relaxed">
            {autoGenError}
          </div>
        )}

        {/* Theme list */}
        <div className="flex-1 overflow-y-auto divide-y divide-rule-dim">
          {themes.length === 0 && (
            <p className="text-xs italic font-sans text-ink-4 p-4 leading-relaxed">
              No themes yet. Create a synthesis theme to begin organising your argument.
            </p>
          )}
          {themes.map(t => {
            const isActive = activeTheme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTheme(t.id)}
                className={[
                  'w-full text-left px-4 py-3 transition-all duration-150',
                  isActive
                    ? 'bg-surface border-l-2 border-l-gold'
                    : 'border-l-2 border-l-transparent hover:bg-raised',
                ].join(' ')}
              >
                <p className={`text-sm font-sans leading-snug ${isActive ? 'text-gold font-medium' : 'text-ink-2'}`}>
                  {t.theme_name}
                </p>
                <p className="text-[10.5px] text-ink-4 mt-0.5 font-sans">
                  {t.linked_citations.length} citation{t.linked_citations.length !== 1 ? 's' : ''}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Theme detail pane ── */}
      {theme ? (
        <div className="bg-surface flex flex-col min-w-0">
          {/* Pane header */}
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-rule-dim">
            <div className="min-w-0">
              <h3 className="font-display text-xl font-semibold text-ink leading-snug">
                {theme.theme_name}
              </h3>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {theme.linked_citations.length === 0 ? (
                  <span className="text-xs italic font-sans text-ink-4">No linked citations</span>
                ) : (
                  theme.linked_citations.map(ck => (
                    <span
                      key={ck}
                      className="inline-flex items-center gap-1 text-[10px] font-mono bg-verd-wash text-verd border border-verd-rule rounded px-1.5 py-0.5"
                    >
                      <IconCitation />{ck}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => onEditTheme(theme)}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-rule text-ink-3 hover:text-ink-2 hover:bg-raised text-xs transition-all duration-150"
              >
                <IconEdit /> Edit
              </button>
              <button
                onClick={() => onDeleteTheme(theme)}
                className="flex items-center gap-1 px-3 py-1.5 rounded border border-rouge-rule bg-rouge-wash text-rouge hover:bg-rouge/15 text-xs transition-all duration-150"
              >
                <IconTrash /> Delete
              </button>
            </div>
          </div>

          {/* Linked paper index cards */}
          {linkedPapers.length > 0 && (
            <div className="px-6 pt-4 pb-2">
              <p className="text-[10px] uppercase tracking-[0.14em] font-sans text-ink-3 mb-2.5">
                Linked Corpus
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ overscrollBehaviorX: 'contain' }}>
                {linkedPapers.map(p => (
                  <div
                    key={p.id}
                    className="shrink-0 w-60 bg-panel border border-rule-dim rounded p-3"
                  >
                    <p className="font-display text-sm text-ink-2 leading-snug mb-1.5 line-clamp-2">
                      {p.title}
                    </p>
                    <p className="text-[10.5px] font-sans text-ink-3">
                      {p.authors?.split(',')[0]}{p.authors?.includes(',') ? ' et al.' : ''}, {p.year}
                    </p>
                    <p className="text-[10px] font-mono text-gold mt-1.5">[{p.citation_key}]</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested Recommendations to Link */}
          {recommendedPapers.length > 0 && (
            <div className="px-6 py-3 bg-gold-wash/10 border-t border-b border-rule-dim">
              <p className="text-[10px] uppercase tracking-[0.14em] font-sans text-gold font-semibold mb-2">
                ◆ Suggested Papers to Link
              </p>
              <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ overscrollBehaviorX: 'contain' }}>
                {recommendedPapers.map(p => (
                  <div
                    key={p.id}
                    className="shrink-0 w-60 bg-panel border border-gold-rule/30 rounded p-2.5 flex flex-col justify-between"
                  >
                    <div>
                      <p className="font-display text-xs text-ink font-semibold truncate leading-snug">
                        {p.title}
                      </p>
                      <p className="text-[9.5px] text-ink-3 font-mono mt-0.5">[{p.citation_key}]</p>
                    </div>
                    <button
                      onClick={() => {
                        onUpdateThemeCitations(theme.id, [...theme.linked_citations, p.citation_key]);
                      }}
                      className="mt-2 self-start text-[10px] font-sans text-gold hover:text-gold-dim font-bold flex items-center gap-1 transition-all"
                    >
                      <IconPlus /> Link to Theme
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Quotes supporting this Theme */}
          {linkedPapers.some(p => (p.key_quotes || []).length > 0) && (
            <div className="px-6 py-3 border-t border-rule-dim bg-panel/25">
              <p className="text-[10px] uppercase tracking-[0.14em] font-sans text-ink-3 mb-2.5">
                Key Quotes supporting this Theme
              </p>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ overscrollBehaviorX: 'contain' }}>
                {linkedPapers.flatMap(p => 
                  (p.key_quotes || [])
                    .filter(q => q.theme?.toLowerCase() === theme.theme_name.toLowerCase())
                    .map((q, idx) => ({ ...q, paper: p, key: `${p.id}-${idx}` }))
                ).map(item => (
                  <div key={item.key} className="shrink-0 w-64 bg-panel border border-rule-dim rounded p-3 flex flex-col justify-between group/quote relative">
                    <p className="italic text-xs font-serif text-ink-2 leading-relaxed">
                      "{item.quote}"
                    </p>
                    <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-rule-dim/40 text-[9px] font-sans text-ink-4">
                      <span className="truncate">— {item.paper.authors?.split(',')[0]} ({item.paper.year})</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.quote);
                        }}
                        className="text-gold-dim hover:text-gold transition-colors font-mono"
                        title="Copy quote"
                      >
                        [copy]
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Theme Bibliography Section */}
          {linkedPapers.length > 0 && (
            <div className="px-6 py-4 border-t border-rule-dim">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase tracking-[0.14em] font-sans text-ink-3">
                  Theme Bibliography
                </p>
                <div className="flex border border-rule-rule rounded overflow-hidden text-[9.5px] font-sans">
                  <button
                    onClick={() => setBibStyle('APA')}
                    className={`px-2.5 py-1 transition-colors duration-150 ${
                      bibStyle === 'APA' ? 'bg-gold text-canvas font-semibold' : 'text-gold-dim hover:text-gold'
                    }`}
                  >
                    APA
                  </button>
                  <button
                    onClick={() => setBibStyle('Harvard')}
                    className={`px-2.5 py-1 border-l border-rule-rule transition-colors duration-150 ${
                      bibStyle === 'Harvard' ? 'bg-gold text-canvas font-semibold' : 'text-gold-dim hover:text-gold'
                    }`}
                  >
                    Harvard
                  </button>
                </div>
              </div>
              
              <div className="relative group bg-panel border border-rule-dim rounded p-4 pr-16 max-h-[160px] overflow-y-auto space-y-2">
                {linkedPapers.map(p => (
                  <div key={p.id} className="text-xs text-ink-2 font-serif leading-relaxed">
                    {formatCitation(p, bibStyle)}
                  </div>
                ))}
                
                <button
                  onClick={() => {
                    const fullText = linkedPapers.map(p => formatCitation(p, bibStyle)).join('\n');
                    navigator.clipboard.writeText(fullText);
                    setCopiedBib(true);
                    setTimeout(() => setCopiedBib(false), 1500);
                  }}
                  className="absolute right-3 top-3 text-[10px] uppercase tracking-wider font-sans bg-raised border border-rule hover:border-gold-dim text-ink-3 hover:text-gold px-2 py-1 rounded transition-all duration-150 opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  {copiedBib ? '✓ Copied' : 'Copy List'}
                </button>
              </div>
            </div>
          )}

          {/* Synthesis draft viewer */}
          <div className="flex-1 px-6 py-4 flex flex-col gap-2.5 border-t border-rule-dim">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.14em] font-sans text-ink-3">
                Synthesis Draft
              </p>
              <button
                onClick={() => generateSynthesisWithAi()}
                disabled={aiLoading || linkedPapers.length === 0}
                className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-sans bg-gold-wash hover:bg-gold/15 text-gold border border-gold-rule px-2.5 py-1 rounded transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
              >
                {aiLoading ? (
                  <>
                    <span className="inline-block w-2.5 h-2.5 border-[1.5px] border-gold/30 border-t-gold rounded-full animate-spin mr-1" />
                    Drafting...
                  </>
                ) : (
                  <>✨ Draft with AI</>
                )}
              </button>
            </div>

            {aiError && (
              <p className="text-xs font-sans text-rouge bg-rouge-wash border border-rouge-rule rounded px-3 py-1.5">
                {aiError}
              </p>
            )}

            <div className="flex-1 bg-panel border border-rule-dim rounded p-4 min-h-[120px]">
              {theme.synthesis_draft ? (
                <p className="font-sans text-[14.5px] leading-relaxed text-ink-2 whitespace-pre-wrap">
                  {theme.synthesis_draft}
                </p>
              ) : (
                <p className="font-sans text-sm italic text-ink-4">
                  No draft yet. Click "✨ Draft with AI" or edit the theme to compose your paragraph manually.
                </p>
              )}
            </div>

            {/* Refinement input */}
            {theme.synthesis_draft && !aiLoading && (
              <div className="flex gap-2 items-center bg-raised border border-rule-dim rounded px-3 py-2">
                <input
                  type="text"
                  placeholder="Ask AI to refine draft (e.g., 'Make tone more critical', 'Contrast these findings')..."
                  className="flex-1 bg-transparent text-xs text-ink placeholder-ink-4 focus:outline-none"
                  value={refinementInput}
                  onChange={e => setRefinementInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && refinementInput.trim()) {
                      generateSynthesisWithAi(refinementInput);
                      setRefinementInput('');
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (refinementInput.trim()) {
                      generateSynthesisWithAi(refinementInput);
                      setRefinementInput('');
                    }
                  }}
                  className="text-xs text-gold hover:text-gold-dim font-bold transition-colors"
                >
                  Refine
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center bg-surface">
          <p className="font-sans text-sm italic text-ink-4">
            Select or create a theme to begin.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Thematic Connectivity Grid ────────────────────────────────────────────────
function ThematicGrid({ papers, themes, onUpdateThemeCitations }) {
  if (themes.length === 0) {
    return (
      <div className="p-8 text-center text-ink-3 italic bg-panel border border-rule rounded">
        Create a theme first to see the connectivity grid.
      </div>
    );
  }
  if (papers.length === 0) {
    return (
      <div className="p-8 text-center text-ink-3 italic bg-panel border border-rule rounded">
        Add some papers to your corpus first.
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-rule bg-panel">
              <th className="p-4 font-sans font-medium text-ink-3 uppercase tracking-wider w-80 sticky left-0 bg-panel border-r border-rule-dim">
                Paper Reference
              </th>
              {themes.map(t => (
                <th key={t.id} className="p-4 font-sans font-medium text-ink-3 uppercase tracking-wider text-center border-r border-rule-dim max-w-[200px] truncate" title={t.theme_name}>
                  {t.theme_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule-dim">
            {papers.map(p => (
              <tr key={p.id} className="hover:bg-panel/40 transition-colors">
                <td className="p-4 font-sans sticky left-0 bg-surface border-r border-rule-dim">
                  <p className="font-display text-sm font-semibold text-ink-2 truncate max-w-[280px]" title={p.title}>
                    {p.title}
                  </p>
                  <p className="text-[10px] font-mono text-gold mt-0.5">[{p.citation_key}]</p>
                </td>
                {themes.map(t => {
                  const isLinked = t.linked_citations.includes(p.citation_key);
                  
                  // Calculate if suggested
                  const isSuggested = !isLinked && (
                    (p.category && (
                      p.category.toLowerCase().includes(t.theme_name.toLowerCase()) ||
                      t.theme_name.toLowerCase().includes(p.category.toLowerCase())
                    )) ||
                    (p.suggested_themes || []).some(st =>
                      st.toLowerCase().includes(t.theme_name.toLowerCase()) ||
                      t.theme_name.toLowerCase().includes(st.toLowerCase())
                    )
                  );

                  return (
                    <td key={t.id} className="p-4 text-center border-r border-rule-dim align-middle">
                      <button
                        onClick={() => {
                          const newCits = isLinked
                            ? t.linked_citations.filter(ck => ck !== p.citation_key)
                            : [...t.linked_citations, p.citation_key];
                          onUpdateThemeCitations(t.id, newCits);
                        }}
                        className={[
                          "w-8 h-8 rounded-full flex items-center justify-center mx-auto transition-all duration-200 border",
                          isLinked
                            ? "bg-verd-wash border-verd text-verd hover:bg-rouge-wash hover:border-rouge hover:text-rouge group"
                            : isSuggested
                              ? "bg-gold-wash/10 border-dashed border-gold-rule text-gold/60 hover:bg-gold-wash hover:text-gold"
                              : "bg-transparent border-transparent text-ink-4 hover:border-rule hover:text-ink-2"
                        ].join(' ')}
                        title={
                          isLinked 
                            ? `Linked to "${t.theme_name}". Click to remove link.` 
                            : isSuggested 
                              ? `Suggested link to "${t.theme_name}". Click to link.` 
                              : `Click to link paper to "${t.theme_name}".`
                        }
                      >
                        {isLinked ? (
                          <>
                            <span className="group-hover:hidden text-lg">◆</span>
                            <span className="hidden group-hover:inline text-xs font-sans font-bold">×</span>
                          </>
                        ) : isSuggested ? (
                          <span className="text-lg">◇</span>
                        ) : (
                          <span className="text-lg">+</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="p-3.5 bg-panel border-t border-rule-dim text-[11px] text-ink-3 flex items-center gap-6 font-sans">
        <span className="font-semibold text-ink-2">Legend:</span>
        <span className="flex items-center gap-1.5"><span className="text-verd text-lg leading-none">◆</span> Linked to theme</span>
        <span className="flex items-center gap-1.5"><span className="text-gold/60 text-lg leading-none">◇</span> AI Suggested connection</span>
        <span className="flex items-center gap-1.5"><span className="text-ink-4 text-lg leading-none">+</span> Click to link manually</span>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [papers, setPapers] = useState(() => {
    const saved = localStorage.getItem('lit_papers');
    return saved ? JSON.parse(saved) : SEED_PAPERS;
  });
  const [themes, setThemes] = useState(() => {
    const saved = localStorage.getItem('lit_themes');
    return saved ? JSON.parse(saved) : SEED_THEMES;
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Theme Toggle State
  const [themeMode, setThemeMode] = useState(() => {
    return localStorage.getItem('lit_theme') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('lit_theme', themeMode);
  }, [themeMode]);

  const toggleTheme = useCallback(() => {
    setThemeMode(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  // Auth state
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Monitor auth state changes
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    }).catch(err => {
      console.error("Auth init error:", err);
      setAuthLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch initial data from Supabase if active & user is logged in
  useEffect(() => {
    if (supabase && user) {
      console.log("Supabase connection detected. Fetching data...");
      
      const fetchData = async () => {
        try {
          // Fetch papers
          const { data: papersData, error: papersError } = await supabase
            .from('papers')
            .select('*')
            .order('created_at', { ascending: true });
          if (papersError) throw papersError;
          setPapers(papersData || []);

          // Fetch themes
          const { data: themesData, error: themesError } = await supabase
            .from('themes')
            .select('*')
            .order('created_at', { ascending: true });
          if (themesError) throw themesError;
          setThemes(themesData || []);

          // Fetch logs
          const { data: logsData, error: logsError } = await supabase
            .from('token_logs')
            .select('*')
            .order('created_at', { ascending: false });
          if (logsError) throw logsError;
          setTokenLogs(logsData || []);
        } catch (err) {
          console.error("Error loading data from Supabase:", err.message);
        }
      };

      fetchData();
    } else if (!user) {
      // offline-first loader
      if (!supabase) {
        const saved = localStorage.getItem('lit_papers');
        setPapers(saved ? JSON.parse(saved) : SEED_PAPERS);
        const savedThemes = localStorage.getItem('lit_themes');
        setThemes(savedThemes ? JSON.parse(savedThemes) : SEED_THEMES);
        const savedLogs = localStorage.getItem('lit_token_logs');
        setTokenLogs(savedLogs ? JSON.parse(savedLogs) : []);
      } else {
        // online, not logged in yet: blank states
        setPapers([]);
        setThemes([]);
        setTokenLogs([]);
      }
    }
  }, [user]);

  // Token Usage Ledger State
  const [tokenLogs, setTokenLogs] = useState(() => {
    const saved = localStorage.getItem('lit_token_logs');
    return saved ? JSON.parse(saved) : [];
  });

  const clearTokenLogs = useCallback(async () => {
    setTokenLogs([]);
    localStorage.removeItem('lit_token_logs');
    if (supabase && user) {
      try {
        await supabase.from('token_logs').delete().eq('user_id', user.id);
      } catch (err) {
        console.error('Error clearing token logs from Supabase:', err.message);
      }
    }
  }, [user]);

  const addTokenLog = useCallback(async (log) => {
    setTokenLogs(prev => {
      const updated = [log, ...prev];
      localStorage.setItem('lit_token_logs', JSON.stringify(updated));
      return updated;
    });
    if (supabase && user) {
      try {
        await supabase.from('token_logs').insert({
          id: log.id,
          user_id: user.id,
          timestamp: log.timestamp,
          activity: log.activity,
          model: log.model,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          totalTokens: log.totalTokens
        });
      } catch (err) {
        console.error('Error syncing log to Supabase:', err.message);
      }
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('lit_papers', JSON.stringify(papers));
  }, [papers]);

  useEffect(() => {
    localStorage.setItem('lit_themes', JSON.stringify(themes));
  }, [themes]);

  // Dialog refs
  const settingsDialogRef = useRef(null);
  const paperFormDialogRef = useRef(null);
  const confirmDialogRef = useRef(null);
  const themeFormDialogRef = useRef(null);
  const citationDialogRef = useRef(null);

  // Modal state
  const [editingPaper, setEditingPaper] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [editingTheme, setEditingTheme] = useState(null);
  const [citingPaper, setCitingPaper] = useState(null);
  const [citationStyle, setCitationStyle] = useState('APA');
  const [synthesisTab, setSynthesisTab] = useState('builder'); // 'builder' | 'grid'

  // Filtered papers
  const filteredPapers = useMemo(() => {
    if (!searchQuery.trim()) return papers;
    const q = searchQuery.toLowerCase();
    return papers.filter(p =>
      p.title.toLowerCase().includes(q) ||
      p.authors.toLowerCase().includes(q) ||
      p.methodology.toLowerCase().includes(q) ||
      p.citation_key.toLowerCase().includes(q)
    );
  }, [papers, searchQuery]);

  // Paper actions
  const openAddPaper = useCallback(() => {
    setEditingPaper(null);
    setTimeout(() => paperFormDialogRef.current?.showModal(), 0);
  }, []);

  const openEditPaper = useCallback((paper) => {
    setEditingPaper(paper);
    setTimeout(() => paperFormDialogRef.current?.showModal(), 0);
  }, []);

  const openCitePaper = useCallback((paper) => {
    setCitingPaper(paper);
    setTimeout(() => citationDialogRef.current?.showModal(), 0);
  }, []);

  const savePaper = useCallback(async (form, selectedThemes = []) => {
    // 1. Save the paper locally
    setPapers(prev => {
      const exists = prev.find(p => p.id === form.id);
      return exists ? prev.map(p => p.id === form.id ? form : p) : [...prev, form];
    });

    if (supabase && user) {
      try {
        await supabase.from('papers').upsert({
          id: form.id,
          user_id: user.id,
          title: form.title,
          authors: form.authors || '',
          year: form.year,
          category: form.category || '',
          suggested_themes: form.suggested_themes || [],
          key_quotes: form.key_quotes || [],
          methodology: form.methodology || '',
          key_findings: form.key_findings || '',
          limitations: form.limitations || '',
          citation_key: form.citation_key,
          relevance_to_my_essay: form.relevance_to_my_essay || ''
        });
      } catch (err) {
        console.error('Error syncing paper to Supabase:', err.message);
      }
    }

    // 2. Automatically create/link selected themes
    if (selectedThemes.length > 0) {
      const updatedThemes = [];
      const createdThemes = [];

      setThemes(prevThemes => {
        let updated = [...prevThemes];
        selectedThemes.forEach(themeName => {
          const existingTheme = updated.find(t => t.theme_name.toLowerCase() === themeName.toLowerCase());
          if (existingTheme) {
            if (!existingTheme.linked_citations.includes(form.citation_key)) {
              const newCitations = [...existingTheme.linked_citations, form.citation_key];
              updated = updated.map(t =>
                t.id === existingTheme.id
                  ? { ...t, linked_citations: newCitations }
                  : t
              );
              updatedThemes.push({ id: existingTheme.id, linked_citations: newCitations });
            }
          } else {
            const newTheme = {
              id: Date.now() + Math.random(),
              theme_name: themeName,
              linked_citations: [form.citation_key],
              synthesis_draft: '',
            };
            updated.push(newTheme);
            createdThemes.push(newTheme);
          }
        });
        return updated;
      });

      if (supabase && user) {
        try {
          for (const ut of updatedThemes) {
            await supabase.from('themes').update({ linked_citations: ut.linked_citations }).eq('id', ut.id).eq('user_id', user.id);
          }
          for (const ct of createdThemes) {
            await supabase.from('themes').insert({
              ...ct,
              user_id: user.id
            });
          }
        } catch (err) {
          console.error('Error syncing auto-themes to Supabase:', err.message);
        }
      }
    }
  }, [user]);

  const updateThemeDraft = useCallback(async (themeId, draftText) => {
    setThemes(prev => prev.map(t => t.id === themeId ? { ...t, synthesis_draft: draftText } : t));
    if (supabase && user) {
      try {
        await supabase.from('themes').update({ synthesis_draft: draftText }).eq('id', themeId).eq('user_id', user.id);
      } catch (err) {
        console.error('Error updating draft in Supabase:', err.message);
      }
    }
  }, [user]);

  const updateThemeCitations = useCallback(async (themeId, citations) => {
    setThemes(prev => prev.map(t => t.id === themeId ? { ...t, linked_citations: citations } : t));
    if (supabase && user) {
      try {
        await supabase.from('themes').update({ linked_citations: citations }).eq('id', themeId).eq('user_id', user.id);
      } catch (err) {
        console.error('Error updating citations in Supabase:', err.message);
      }
    }
  }, [user]);

  const addGeneratedThemes = useCallback(async (newThemes) => {
    setThemes(prev => {
      let updated = [...prev];
      newThemes.forEach(nt => {
        const exists = updated.some(t => t.theme_name.toLowerCase() === nt.theme_name.toLowerCase());
        if (!exists) {
          updated.push(nt);
        }
      });
      return updated;
    });

    if (supabase && user) {
      try {
        for (const nt of newThemes) {
          await supabase.from('themes').upsert({
            id: nt.id,
            user_id: user.id,
            theme_name: nt.theme_name,
            linked_citations: nt.linked_citations,
            synthesis_draft: nt.synthesis_draft
          });
        }
      } catch (err) {
        console.error('Error syncing generated themes to Supabase:', err.message);
      }
    }
  }, [user]);

  const openDeletePaper = useCallback((paper) => {
    setPendingDelete({ type: 'paper', item: paper });
    setTimeout(() => confirmDialogRef.current?.showModal(), 0);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'paper') {
      setPapers(prev => prev.filter(p => p.id !== pendingDelete.item.id));
      if (supabase && user) {
        try {
          await supabase.from('papers').delete().eq('id', pendingDelete.item.id).eq('user_id', user.id);
        } catch (err) {
          console.error('Error deleting paper from Supabase:', err.message);
        }
      }
    } else if (pendingDelete.type === 'theme') {
      setThemes(prev => prev.filter(t => t.id !== pendingDelete.item.id));
      if (supabase && user) {
        try {
          await supabase.from('themes').delete().eq('id', pendingDelete.item.id).eq('user_id', user.id);
        } catch (err) {
          console.error('Error deleting theme from Supabase:', err.message);
        }
      }
    }
    setPendingDelete(null);
  }, [pendingDelete, user]);

  // Theme actions
  const openAddTheme = useCallback(() => {
    setEditingTheme(null);
    setTimeout(() => themeFormDialogRef.current?.showModal(), 0);
  }, []);

  const openEditTheme = useCallback((theme) => {
    setEditingTheme(theme);
    setTimeout(() => themeFormDialogRef.current?.showModal(), 0);
  }, []);

  const saveTheme = useCallback(async (form) => {
    setThemes(prev => {
      const exists = prev.find(t => t.id === form.id);
      return exists ? prev.map(t => t.id === form.id ? form : t) : [...prev, form];
    });

    if (supabase && user) {
      try {
        await supabase.from('themes').upsert({
          id: form.id,
          user_id: user.id,
          theme_name: form.theme_name,
          linked_citations: form.linked_citations,
          synthesis_draft: form.synthesis_draft
        });
      } catch (err) {
        console.error('Error syncing theme to Supabase:', err.message);
      }
    }
  }, [user]);

  const openDeleteTheme = useCallback((theme) => {
    setPendingDelete({ type: 'theme', item: theme });
    setTimeout(() => confirmDialogRef.current?.showModal(), 0);
  }, []);

  if (supabase && authLoading) {
    return (
      <div className="min-h-dvh flex flex-col bg-canvas justify-center items-center">
        <div className="page-crown" aria-hidden="true" />
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-display italic text-ink-3 text-base tracking-wide">Retrieving scholar record...</p>
        </div>
      </div>
    );
  }

  if (supabase && !user) {
    return <AuthScreen onLogin={setUser} themeMode={themeMode} toggleTheme={toggleTheme} />;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-canvas">
      {/* Gold crown stripe */}
      <div className="page-crown" aria-hidden="true" />

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-canvas/92 backdrop-blur-md border-b border-rule-dim pt-0.5">
        <div className="max-w-[1600px] mx-auto px-5 sm:px-8 h-[52px] flex items-center gap-5">

          {/* Brand mark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-gold text-sm select-none" aria-hidden="true">◆</span>
            <span className="font-display text-base font-semibold tracking-[0.04em] text-ink hidden sm:block">
              LitReview <span className="text-ink-3 font-normal italic">Matrix</span>
            </span>
          </div>

          {/* Vertical rule */}
          <div className="hidden sm:block h-4 w-px bg-rule-dim" />

          {/* Search */}
          <div className="flex-1 max-w-lg relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none">
              <IconSearch />
            </span>
            <input
              type="search"
              placeholder="Search title, author, methodology, citation key…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-panel border border-rule-dim rounded pl-9 pr-8 py-1.5 text-sm font-sans text-ink-2 placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold transition-all duration-200"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-3 transition-colors"
              >
                <IconClose />
              </button>
            )}
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-2 ml-auto">
            {supabase && user && (
              <div className="hidden md:flex items-center gap-2.5 mr-2">
                <span className="text-xs font-sans text-ink-3 italic" title={user.email}>
                  {user.user_metadata?.username || user.email}
                </span>
                <div className="h-3 w-px bg-rule-dim" />
                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                  }}
                  className="text-xs font-sans font-semibold text-gold hover:text-gold-dim transition-colors"
                  title="Sign Out"
                >
                  Sign Out
                </button>
              </div>
            )}
            
            <button
              onClick={openAddPaper}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-gold hover:bg-gold-dim text-canvas text-sm font-semibold transition-all duration-200 shadow-[0_2px_10px_oklch(73%_0.13_76/20%)]"
            >
              <IconPlus />
              <span className="hidden sm:inline">Add Paper</span>
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded text-ink-3 hover:text-ink-2 hover:bg-panel transition-all duration-200"
              title={themeMode === 'dark' ? "Switch to Light Mode" : "Switch to Night Mode"}
            >
              {themeMode === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
            <button
              onClick={() => settingsDialogRef.current?.showModal()}
              className="p-2 rounded text-ink-3 hover:text-ink-2 hover:bg-panel transition-all duration-200"
              title="API Settings"
            >
              <IconSettings />
            </button>

            {/* Mobile Sign Out button */}
            {supabase && user && (
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                }}
                className="md:hidden p-2 rounded text-red-400 hover:text-red-300 hover:bg-panel transition-all duration-200"
                title="Sign Out"
              >
                <svg className="w-5.5 h-5.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-[1600px] mx-auto w-full px-5 sm:px-8 py-7 space-y-9">

        {/* § Literature Review Matrix */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <h1 className="font-display text-2xl font-semibold text-ink tracking-wide">
                Literature Review Matrix
              </h1>
              <p className="text-[11px] font-sans text-ink-3 mt-0.5 tracking-wide">
                {filteredPapers.length} of {papers.length} entr{papers.length !== 1 ? 'ies' : 'y'}
                {searchQuery ? ` — filtered by "${searchQuery}"` : ''}
              </p>
            </div>
          </div>
          <div className="bg-surface border border-rule rounded overflow-hidden">
            <MatrixTable papers={filteredPapers} onEdit={openEditPaper} onDelete={openDeletePaper} onCite={openCitePaper} />
          </div>
        </section>

        {/* Ornamental divider */}
        <OrnamentDivider label="Synthesis Builder" />

        {/* § Synthesis Themes */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4 mb-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink tracking-wide">
                Synthesis Themes &amp; Citation Planner
              </h2>
              <p className="text-[11px] font-sans text-ink-3 mt-0.5 tracking-wide">
                Organise papers into thematic arguments and draft your essay synthesis.
              </p>
            </div>
            
            {/* Tabs for Synthesis Builder & Matrix Grid */}
            <div className="flex border border-rule rounded overflow-hidden text-xs font-sans self-start">
              <button
                onClick={() => setSynthesisTab('builder')}
                className={`px-4 py-1.5 transition-colors duration-150 ${
                  synthesisTab === 'builder'
                    ? 'bg-gold text-canvas font-semibold'
                    : 'text-gold-dim hover:text-gold'
                }`}
              >
                Drafting &amp; Synthesis
              </button>
              <button
                onClick={() => setSynthesisTab('grid')}
                className={`px-4 py-1.5 border-l border-rule transition-colors duration-150 ${
                  synthesisTab === 'grid'
                    ? 'bg-gold text-canvas font-semibold'
                    : 'text-gold-dim hover:text-gold'
                }`}
              >
                Connectivity Grid Map
              </button>
            </div>
          </div>
          
          {synthesisTab === 'builder' ? (
            <SynthesisBuilder
              themes={themes}
              papers={papers}
              onAddTheme={openAddTheme}
              onEditTheme={openEditTheme}
              onDeleteTheme={openDeleteTheme}
              onUpdateThemeDraft={updateThemeDraft}
              onUpdateThemeCitations={updateThemeCitations}
              onAddGeneratedThemes={addGeneratedThemes}
              onAddTokenLog={addTokenLog}
            />
          ) : (
            <ThematicGrid
              papers={papers}
              themes={themes}
              onUpdateThemeCitations={updateThemeCitations}
            />
          )}
        </section>

        {/* Footer colophon */}
        <footer className="text-center py-5 border-t border-rule-dim">
          <p className="font-display italic text-ink-4 text-sm tracking-wide">
            LitReview Matrix &mdash; an academic research instrument
          </p>
          <p className="text-[10px] font-sans text-ink-4 mt-1 tracking-widest uppercase">
            All data stored in-memory &amp; localStorage · No server transmission
          </p>
        </footer>
      </main>

      {/* ── Modals ─────────────────────────────────────────────── */}
      <SettingsModal
        dialogRef={settingsDialogRef}
        tokenLogs={tokenLogs}
        onClearLogs={clearTokenLogs}
      />

      <PaperFormModal
        dialogRef={paperFormDialogRef}
        initial={editingPaper}
        onSave={savePaper}
        onAddTokenLog={addTokenLog}
      />

      <ConfirmModal
        dialogRef={confirmDialogRef}
        message={
          pendingDelete?.type === 'paper'
            ? `Remove "${pendingDelete?.item?.title}" from the corpus? This action cannot be undone.`
            : `Delete the theme "${pendingDelete?.item?.theme_name}"? This action cannot be undone.`
        }
        onConfirm={confirmDelete}
      />

      <ThemeFormModal
        dialogRef={themeFormDialogRef}
        initial={editingTheme}
        papers={papers}
        onSave={saveTheme}
        onAddTokenLog={addTokenLog}
        citationStyle={citationStyle}
      />

      <CitationModal
        dialogRef={citationDialogRef}
        paper={citingPaper}
        style={citationStyle}
        setStyle={setCitationStyle}
      />
    </div>
  );
}

function AuthScreen({ onLogin, themeMode, toggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.trim() || email.split('@')[0]
            }
          }
        });
        if (signUpError) throw signUpError;
        setMessage("Verification link sent! Please check your email to activate your account.");
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        if (data?.user) {
          onLogin(data.user);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col bg-canvas justify-center items-center px-4 relative">
      <div className="page-crown" aria-hidden="true" />
      
      {/* Night/Light mode toggle on login screen */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleTheme}
          className="p-2 rounded text-ink-3 hover:text-ink-2 hover:bg-panel transition-all duration-200"
          title={themeMode === 'dark' ? "Switch to Light Mode" : "Switch to Night Mode"}
        >
          {themeMode === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
      </div>

      <div className="w-full max-w-md bg-surface border border-rule rounded-lg shadow-xl p-8 space-y-6 relative overflow-hidden">
        {/* Decorative corner borders */}
        <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-gold/30 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-gold/30 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-gold/30 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-gold/30 rounded-br-lg" />

        <div className="text-center space-y-2">
          <div className="text-gold text-sm select-none">◆</div>
          <h1 className="font-display text-2xl font-semibold text-ink tracking-wide">
            LitReview <span className="text-ink-3 font-normal italic">Matrix</span>
          </h1>
          <p className="text-[10px] font-sans text-ink-3 uppercase tracking-widest">
            Scholar Portal Authentication
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3.5 text-xs rounded bg-red-950/20 border border-red-500/30 text-red-400 font-sans leading-relaxed">
              {error}
            </div>
          )}
          {message && (
            <div className="p-3.5 text-xs rounded bg-gold/10 border border-gold/30 text-gold font-sans leading-relaxed">
              {message}
            </div>
          )}

          {isSignUp && (
            <div className="space-y-1">
              <label className="text-[11px] font-sans font-semibold text-ink-3 uppercase tracking-wider block">
                Scholar Username
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. Dr. Farhan"
                className="w-full bg-panel border border-rule-dim rounded px-3 py-2 text-sm font-sans text-ink-2 placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[11px] font-sans font-semibold text-ink-3 uppercase tracking-wider block">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="scholar@academy.edu"
              className="w-full bg-panel border border-rule-dim rounded px-3 py-2 text-sm font-sans text-ink-2 placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-sans font-semibold text-ink-3 uppercase tracking-wider block">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-panel border border-rule-dim rounded px-3 py-2 text-sm font-sans text-ink-2 placeholder-ink-4 focus:outline-none focus:ring-1 focus:ring-gold focus:border-gold"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 rounded bg-gold hover:bg-gold-dim text-canvas font-sans font-semibold text-sm transition-all duration-200 shadow-md disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? "Processing..." : isSignUp ? "Create Scholar Account" : "Access Library Matrix"}
          </button>
        </form>

        <div className="text-center pt-2">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setMessage(null);
            }}
            className="text-xs font-sans text-gold-dim hover:text-gold transition-colors underline underline-offset-4"
          >
            {isSignUp ? "Already have an account? Sign In" : "Register new scholar account"}
          </button>
        </div>
      </div>

      <footer className="absolute bottom-6 text-center">
        <p className="font-display italic text-ink-4 text-xs tracking-wide">
          LitReview Matrix &mdash; an academic research instrument
        </p>
      </footer>
    </div>
  );
}

