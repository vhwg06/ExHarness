// Deterministic negative-case binding checks for the outer Blackboard Worker gate.
// Pure: callers pass plan objects, verification-log text and candidate test source; no I/O here.
const fail = message => { throw new Error(`BLACKBOARD_DELIVERY_INVALID: ${message}`); };
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SYMBOL = /^[A-Za-z_$][\w$]*$/;
const BINDING_KEYS = ['id', 'negativeCaseIndex', 'criterionId', 'verificationId', 'testRef', 'testTitle', 'subjectSymbol'];

export function assertNegativeCaseBindings(plan) {
  const bindings = plan?.negativeCaseBindings;
  if (!Array.isArray(bindings)) fail('negativeCaseBindings must be an array');
  const cases = plan.negativeVerificationCases;
  if (!Array.isArray(cases)) fail('negativeCaseBindings requires negativeVerificationCases');
  const criteria = new Map((plan.acceptanceCriteria ?? []).map(c => [c.id, c]));
  const runs = new Set((plan.verificationPlan ?? []).map(v => v.id));
  const expectedTests = plan.sourceSeams?.expectedTests ?? [];
  const reserved = new Set([...criteria.keys(), plan.livingDocs?.questionId].filter(Boolean));
  const ids = new Set(), covered = new Map(), titles = new Set();
  for (const b of bindings) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) fail('negativeCaseBinding must be an object');
    for (const key of Object.keys(b)) if (!BINDING_KEYS.includes(key)) fail(`negativeCaseBinding field not allowed: ${key}`);
    if (typeof b.id !== 'string' || !SAFE_ID.test(b.id)) fail(`unsafe negativeCaseBinding id: ${b.id}`);
    if (ids.has(b.id)) fail(`duplicate negativeCaseBinding id: ${b.id}`);
    if (reserved.has(b.id)) fail(`negativeCaseBinding id collides with a Jev question: ${b.id}`);
    ids.add(b.id);
    if (!Number.isInteger(b.negativeCaseIndex) || b.negativeCaseIndex < 0 || b.negativeCaseIndex >= cases.length) fail(`negativeCaseIndex out of range: ${b.id}`);
    if (covered.has(b.negativeCaseIndex)) fail(`negative case ${b.negativeCaseIndex} bound more than once: ${b.id}`);
    covered.set(b.negativeCaseIndex, b.id);
    const criterion = criteria.get(b.criterionId);
    if (!criterion) fail(`unknown negativeCaseBinding criterion: ${b.id} -> ${b.criterionId}`);
    if (!runs.has(b.verificationId)) fail(`unknown negativeCaseBinding verification: ${b.id} -> ${b.verificationId}`);
    if (!criterion.verificationIds?.includes(b.verificationId)) fail(`verification ${b.verificationId} does not verify criterion ${b.criterionId}: ${b.id}`);
    if (typeof b.testRef !== 'string' || !expectedTests.includes(b.testRef)) fail(`negativeCaseBinding testRef is not an expected test: ${b.id}`);
    if (typeof b.testTitle !== 'string' || !b.testTitle.trim()) fail(`negativeCaseBinding testTitle required: ${b.id}`);
    if (typeof b.subjectSymbol !== 'string' || !SYMBOL.test(b.subjectSymbol)) fail(`unsafe negativeCaseBinding subjectSymbol: ${b.id}`);
    const titleKey = `${b.testRef}\u0000${b.testTitle.trim()}`;
    if (titles.has(titleKey)) fail(`one test title cannot establish several negative cases; use distinct titles per index: ${b.testTitle}`);
    titles.add(titleKey);
  }
  for (let i = 0; i < cases.length; i++) if (!covered.has(i)) fail(`negative case ${i} is not bound`);
  return bindings;
}

// No-retrofit policy: mandatory only for work ids at or above the policy threshold.
export function negativeCaseBindingsRequired(policy, workId, plan) {
  const threshold = policy?.negativeCaseBindingsFromWorkId ?? null;
  if (threshold === null) return false;
  if (typeof threshold !== 'string' || !/^BB-\d+$/.test(threshold)) fail('negativeCaseBindingsFromWorkId must be a BB id or null');
  if (!/^BB-\d+$/.test(workId ?? '')) fail(`invalid work id: ${workId}`);
  return Number(workId.slice(3)) >= Number(threshold.slice(3)) && Array.isArray(plan?.negativeVerificationCases) && plan.negativeVerificationCases.length > 0;
}
export function assertNegativeCaseEnforcement(policy, workId, plan) {
  if (negativeCaseBindingsRequired(policy, workId, plan) && plan.negativeCaseBindings === undefined)
    fail(`negative cases require negativeCaseBindings at or above ${policy.negativeCaseBindingsFromWorkId}: ${workId}`);
  if (plan?.negativeCaseBindings !== undefined) assertNegativeCaseBindings(plan);
}

const unescapeTap = s => s.replace(/\\(.)/g, '$1');
// Spec reporter ('✔ title (Nms)') and TAP ('ok N - title') are accepted; titles match exactly after trim.
export function testPassedInLog(log, title) {
  const want = String(title ?? '').trim();
  if (!want) return { ok: false, reason: 'TITLE_MISSING' };
  let passed = 0, failed = 0, skipped = 0;
  for (const raw of String(log ?? '').split(/\r?\n/)) {
    const tap = raw.match(/^\s*(not ok|ok) \d+ - (.*)$/);
    if (tap) {
      const directive = tap[2].match(/\s#\s*(SKIP|TODO)\b.*$/i);
      const name = unescapeTap((directive ? tap[2].slice(0, directive.index) : tap[2])).trim();
      if (name !== want) continue;
      if (tap[1] === 'not ok') failed++; else if (directive) skipped++; else passed++;
      continue;
    }
    const spec = raw.match(/^\s*(✔|✖|﹣)\s+(.*?)(?:\s+\(\d+(?:\.\d+)?m?s\))?(\s+#\s*(?:SKIP|TODO)\b.*)?\s*$/);
    if (spec && spec[2].trim() === want) {
      if (spec[1] === '✖') failed++; else if (spec[1] === '﹣' || spec[3]) skipped++; else passed++;
    }
  }
  if (failed) return { ok: false, reason: 'TEST_FAILED' };
  if (skipped) return { ok: false, reason: 'TEST_SKIPPED' };
  if (passed === 0) return { ok: false, reason: 'TITLE_MISSING' };
  if (passed > 1) return { ok: false, reason: 'TITLE_DUPLICATE' };
  return { ok: true };
}

const REGEX_PREFIX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
// Small JS tokenizer: skips string, template, regex and comment content so parentheses balance correctly.
export function tokenize(source) {
  const src = String(source), tokens = [];
  const push = (type, start, end, value) => tokens.push({ type, start, end, value });
  const prevSignificant = () => tokens[tokens.length - 1];
  function readString(i) {
    const q = src[i]; let j = i + 1, value = '';
    while (j < src.length && src[j] !== q) {
      if (src[j] === '\\') { value += src[j + 1] ?? ''; j += 2; continue; }
      if (src[j] === '\n') fail('unterminated string literal');
      value += src[j++];
    }
    if (j >= src.length) fail('unterminated string literal');
    return { end: j + 1, value };
  }
  function readTemplate(i) {
    let j = i + 1, value = '', interpolated = false;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') { value += src[j + 1] ?? ''; j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') { interpolated = true; j = scan(j + 2, true); continue; }
      value += src[j++];
    }
    if (j >= src.length) fail('unterminated template literal');
    return { end: j + 1, value: interpolated ? null : value };
  }
  function readRegex(i) {
    let j = i + 1, inClass = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') fail('unterminated regex literal');
      if (inClass) { if (c === ']') inClass = false; }
      else if (c === '[') inClass = true;
      else if (c === '/') break;
      j++;
    }
    j++;
    while (j < src.length && /[a-z]/i.test(src[j])) j++;
    return j;
  }
  // Scans code; when `untilBrace`, stops after the '}' that closes a template expression.
  function scan(i, untilBrace) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) fail('unterminated comment'); i = e + 2; continue; }
      if (c === '"' || c === "'") { const r = readString(i); push('string', i, r.end, r.value); i = r.end; continue; }
      if (c === '`') { const r = readTemplate(i); push('template', i, r.end, r.value); i = r.end; continue; }
      if (c === '/') {
        const prev = prevSignificant();
        if (!prev || (prev.type === 'punct' && REGEX_PREFIX.has(prev.value)) || (prev.type === 'ident' && REGEX_KEYWORDS.has(prev.value))) {
          const e = readRegex(i); push('regex', i, e, src.slice(i, e)); i = e; continue;
        }
      }
      if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < src.length && /[\w$]/.test(src[j])) j++; push('ident', i, j, src.slice(i, j)); i = j; continue; }
      if (/[0-9]/.test(c)) { let j = i + 1; while (j < src.length && /[\w.]/.test(src[j])) j++; push('number', i, j, src.slice(i, j)); i = j; continue; }
      if (untilBrace) {
        if (c === '{') depth++;
        else if (c === '}') { if (depth === 0) return i + 1; depth--; }
      }
      if (c === '?' && src[i + 1] === '.') { push('punct', i, i + 2, '?.'); i += 2; continue; }
      push('punct', i, i + 1, c); i++;
    }
    if (untilBrace) fail('unterminated template expression');
    return i;
  }
  scan(0, false);
  return tokens;
}

// Returns the full text of the single test(...)/it(...) call whose literal title equals `title`.
export function extractTestBody(source, title) {
  const want = String(title ?? '').trim();
  let tokens;
  try { tokens = tokenize(source); } catch { return { ok: false, reason: 'SOURCE_UNPARSEABLE' }; }
  const matches = [];
  for (let k = 0; k < tokens.length - 2; k++) {
    const t = tokens[k];
    if (t.type !== 'ident' || !['test', 'it'].includes(t.value)) continue;
    if (tokens[k + 1].type !== 'punct' || tokens[k + 1].value !== '(') continue;
    const arg = tokens[k + 2];
    if (!['string', 'template'].includes(arg.type) || arg.value === null || arg.value.trim() !== want) continue;
    let depth = 0, end = -1;
    for (let m = k + 1; m < tokens.length; m++) {
      if (tokens[m].type !== 'punct') continue;
      if (tokens[m].value === '(') depth++;
      else if (tokens[m].value === ')' && --depth === 0) { end = m; break; }
    }
    if (end < 0) return { ok: false, reason: 'SOURCE_UNPARSEABLE' };
    const start = k > 0 && tokens[k - 1].type === 'punct' && tokens[k - 1].value === '.' && tokens[k - 2]?.type === 'ident' ? tokens[k - 2].start : t.start;
    matches.push(source.slice(start, tokens[end].end));
  }
  if (matches.length === 0) return { ok: false, reason: 'BODY_NOT_FOUND' };
  if (matches.length > 1) return { ok: false, reason: 'BODY_AMBIGUOUS' };
  return { ok: true, body: matches[0] };
}

const VACUOUS = [/\|\|\s*true\s*\)/, /\bassert\.ok\(\s*true\b/, /(^|[^.\w$])assert\(\s*true\b/, /\bassert\.equal\(\s*1\s*,\s*1\b/];
export function checkBinding({ binding, log, testSource }) {
  const passed = testPassedInLog(log, binding?.testTitle);
  if (!passed.ok) return passed;
  const extracted = extractTestBody(testSource, binding.testTitle);
  if (!extracted.ok) return extracted;
  const body = extracted.body, tokens = tokenize(body);
  // Code with comments removed and strings kept as opaque placeholders.
  const code = tokens.map(t => t.type === 'string' || t.type === 'template' ? '"s"' : t.type === 'regex' ? '/r/' : t.value).join(' ')
    .replace(/\s*([().,])\s*/g, '$1').replace(/\s*\|\s*\|\s*/g, '||');
  const invoked = tokens.some((t, k) => t.type === 'ident' && t.value === binding.subjectSymbol && tokens[k - 1]?.value !== 'function' && (
    (tokens[k + 1]?.type === 'punct' && tokens[k + 1].value === '(') ||
    (tokens[k + 1]?.value === '?.' && tokens[k + 2]?.value === '(') ||
    // A subject that is an object (an adapter or facade) is invoked through one of its methods.
    (['.', '?.'].includes(tokens[k + 1]?.value) && tokens[k - 1]?.value !== '.' && tokens[k - 1]?.value !== '?.' &&
      tokens[k + 2]?.type === 'ident' && tokens[k + 3]?.value === '(') ||
    (tokens[k - 1]?.type === 'ident' && tokens[k - 1].value === 'new')));
  if (!invoked) return { ok: false, reason: 'SUBJECT_NOT_INVOKED', body };
  if (VACUOUS.some(p => p.test(code))) return { ok: false, reason: 'VACUOUS_ASSERTION', body };
  const assertions = tokens.filter((t, k) => t.type === 'ident' && (
    (t.value === 'assert' && ['(', '.'].includes(tokens[k + 1]?.value)) ||
    (t.value === 'expect' && tokens[k + 1]?.value === '('))).length;
  if (assertions === 0) return { ok: false, reason: 'NO_ASSERTION', body };
  return { ok: true, body };
}
