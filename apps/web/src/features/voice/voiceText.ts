/**
 * Voice mode's pure parts: what of a reply is read aloud, and when the user has finished
 * speaking. Kept free of the DOM so they can be tested offline.
 */

/** Replies are read up to about this many characters; the rest stays on screen. */
export const SPEAK_MAX_CHARS = 600;

const ON_SCREEN = 'The rest is on screen.';
const ANSWER_ON_SCREEN = 'The answer is on screen.';

/**
 * The prose of a Markdown reply, fit to be read aloud: code blocks, tables, images and URLs
 * are dropped (said as "on screen" when that leaves nothing), formatting marks removed, and the
 * text cut at a sentence end near `maxChars`.
 */
export function speakableText(markdown: string, maxChars = SPEAK_MAX_CHARS): string {
  let hadHidden = false;
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, () => {
      hadHidden = true;
      return '\n';
    })
    .split('\n')
    .filter((line) => {
      const isTable = /^\s*\|.*\|\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line);
      if (isTable) hadHidden = true;
      return !isTable;
    })
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+/, ''),
    )
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    // Each paragraph or list item ends as a sentence, so it's read with a pause.
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return hadHidden ? ANSWER_ON_SCREEN : '';
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  const head =
    end > maxChars / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  return `${head} ${ON_SCREEN}`;
}

/**
 * What a voice-mode reply asks to have read aloud: the text of its `<spoken>` blocks, made
 * speakable. A block still being written gives its finished sentences (all of it with
 * `isFinal`). `null` when the text has no `<spoken>` block: then it isn't meant to be heard.
 */
export function spokenSoFar(markdown: string, isFinal: boolean): string | null {
  if (!/<spoken>/i.test(markdown)) return null;
  const parts: string[] = [];
  for (const match of markdown.matchAll(/<spoken>([\s\S]*?)(<\/spoken>|$)/gi)) {
    const body = match[1] ?? '';
    // A half-streamed closing tag ("</spo") ends the block too: what's before it is complete.
    const isClosing = /<\/[a-z]*$/i.test(body);
    const isClosed = Boolean(match[2]) || isClosing;
    const text = body.replace(/<\/?[a-z]*$/i, '');
    const said = isClosed || isFinal ? speakableText(text) : speakableSoFar(text, false);
    if (said) parts.push(said);
  }
  return parts.join(' ');
}

/**
 * What of a reply still being written can be read aloud now: its speakable text up to the last
 * finished sentence or line, never inside a code block that is still open. With `isFinal`, all
 * of it (as `speakableText`). As the reply grows, each result starts with the one before, so
 * only the new end needs to be spoken (see `unsaid`).
 */
export function speakableSoFar(
  markdown: string,
  isFinal: boolean,
  maxChars = SPEAK_MAX_CHARS,
): string {
  if (isFinal) return speakableText(markdown, maxChars);
  let text = markdown;
  if ((text.match(/```/g)?.length ?? 0) % 2 === 1) text = text.slice(0, text.lastIndexOf('```'));
  const ends = [...text.matchAll(/\n|[.!?…]["')\]]*\s/g)];
  const last = ends.at(-1);
  text = last?.index === undefined ? '' : text.slice(0, last.index + last[0].length);
  const spoken = speakableText(text, maxChars);
  // Only hidden parts so far: the prose may still come.
  return spoken === ANSWER_ON_SCREEN ? '' : spoken;
}

/**
 * The part of `now` not yet read aloud, given `said` (an earlier `speakableSoFar` of the same
 * text). If the two differ before the end (formatting that only made sense once more arrived),
 * it goes on from the next sentence rather than repeating words.
 */
export function unsaid(said: string, now: string): string {
  if (now.startsWith(said)) return now.slice(said.length).trim();
  return sentencesOf(now).slice(sentencesOf(said).length).join(' ');
}

const sentencesOf = (text: string): string[] =>
  (text.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);

/**
 * Splits text at sentence ends into parts of at most about `maxChars` (`firstMaxChars` for the
 * first), each sent for speech on its own: a short first part starts playing sooner.
 */
export function speechChunks(text: string, maxChars = 220, firstMaxChars = maxChars): string[] {
  const chunks: string[] = [];
  for (const sentence of sentencesOf(text)) {
    const last = chunks.at(-1);
    const limit = chunks.length === 1 ? firstMaxChars : maxChars;
    if (last !== undefined && last.length + sentence.length + 1 <= limit) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}

/**
 * What speech-to-text servers return for audio with no real speech in it (Whisper is known to
 * "hear" these in noise and silence), compared after `normalize`.
 */
const PHANTOM_PHRASES = new Set([
  'you',
  'thank you',
  'thanks',
  'thank you very much',
  'thanks for watching',
  'thank you for watching',
  'thanks for watching and see you next time',
  'please subscribe',
  'subscribe',
  'like and subscribe',
  'bye',
  'bye bye',
  'so',
  'oh',
  'uh',
  'um',
  'hmm',
  'mm',
  'ah',
  'huh',
  'music',
  'applause',
  'laughter',
  'silence',
  'blank audio',
  'inaudible',
  'noise',
  'background noise',
  'the end',
  'subtitles by the amaraorg community',
  'transcribed by',
  'transcription by castingwords',
]);

/** Lowercase words only: punctuation, brackets and extra spaces gone. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordsOf = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

/**
 * Whether `text` is something the user actually said, worth sending: not empty, not a sound
 * tag like "[Music]" or "(coughs)", not a filler or a phrase the server invents from noise, and
 * not the assistant's own words heard back through the speakers (`lastSpoken`).
 */
export function isMeaningfulTranscript(text: string, lastSpoken = ''): boolean {
  // Only sound tags or symbols: "[BLANK_AUDIO]", "(wind)", "♪♪".
  const untagged = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, ' ');
  const words = wordsOf(untagged);
  if (!words.length) return false;
  const joined = words.join(' ');
  if (PHANTOM_PHRASES.has(joined)) return false;
  // The same word over and over ("you you you"): a noise artefact.
  if (words.length >= 3 && new Set(words).size === 1) return false;
  return !isEcho(words, lastSpoken);
}

/**
 * Whether the words are mostly the reply just read aloud (the mic picked up the speakers):
 * most of their three-word runs appear in it.
 */
export function isEcho(words: string[], lastSpoken: string): boolean {
  const spoken = wordsOf(lastSpoken);
  if (!spoken.length || !words.length) return false;
  if (words.length < 3) {
    const said = ` ${spoken.join(' ')} `;
    return words.length > 0 && said.includes(` ${words.join(' ')} `) && words.join('').length > 3;
  }
  const runs = new Set<string>();
  for (let i = 0; i + 3 <= spoken.length; i += 1) runs.add(spoken.slice(i, i + 3).join(' '));
  let hits = 0;
  let total = 0;
  for (let i = 0; i + 3 <= words.length; i += 1) {
    total += 1;
    if (runs.has(words.slice(i, i + 3).join(' '))) hits += 1;
  }
  return total > 0 && hits / total >= 0.6;
}
